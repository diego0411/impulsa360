package com.integrat360.impulsa360

import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.bumptech.glide.load.resource.bitmap.DownsampleStrategy
import com.bumptech.glide.request.RequestOptions
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

class ImageDownsamplerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private enum class Phase { LOADING, PROCESSING, FINISHED }

  private class Operation(
    val id: String,
    val output: File,
    val promise: Promise
  ) {
    val settled = AtomicBoolean(false)
    val cancelRequested = AtomicBoolean(false)
    val targetCleared = AtomicBoolean(false)
    val outputDeleted = AtomicBoolean(false)
    var phase = Phase.LOADING
    var target: CustomTarget<Bitmap>? = null
    var cancelPromise: Promise? = null
  }

  // Glide y activeOperation pertenecen al hilo principal. El executor solo
  // comprime/escribe; el target se retiene hasta que ese trabajo finaliza.
  private var activeOperation: Operation? = null
  private val destroyed = AtomicBoolean(false)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val compressionExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "impulsa-image-downsampler").apply { isDaemon = true }
  }

  override fun getName(): String = "ImpulsaImageDownsampler"

  @ReactMethod
  fun downsample(uri: String?, maxSide: Double, quality: Double, operationId: String?, promise: Promise) {
    val source = uri?.trim().orEmpty()
    val id = operationId?.trim().orEmpty()
    if (
      source.isEmpty()
      || id.isEmpty()
      || !maxSide.isFinite()
      || maxSide < 1
      || maxSide > 4096
      || !quality.isFinite()
    ) {
      runOnUiThread {
        if (!destroyed.get()) {
          promise.reject("E_DOWNSAMPLE_ARGUMENT", "URI, operacion o parametros de reduccion invalidos.")
        }
      }
      return
    }

    val side = maxSide.toInt()
    val qualityInt = (quality.coerceIn(0.0, 1.0) * 100).toInt()
    reactApplicationContext.runOnUiQueueThread {
      startDownsample(source, side, qualityInt, id, promise)
    }
  }

  @ReactMethod
  fun cancel(operationId: String?, promise: Promise) {
    val id = operationId?.trim().orEmpty()
    if (id.isEmpty()) {
      runOnUiThread {
        if (!destroyed.get()) promise.resolve(false)
      }
      return
    }
    reactApplicationContext.runOnUiQueueThread {
      val operation = activeOperation
      if (operation == null || operation.id != id) {
        promise.resolve(false)
        return@runOnUiQueueThread
      }
      if (operation.settled.get() || !operation.cancelRequested.compareAndSet(false, true)) {
        promise.resolve(false)
        return@runOnUiQueueThread
      }
      if (operation.phase == Phase.PROCESSING) {
        // Bitmap.compress no es cancelable de forma segura. El target y la
        // exclusión se conservan hasta que el worker termine y limpie la salida.
        operation.cancelPromise = promise
        return@runOnUiQueueThread
      }
      finishLoadingCancellation(operation, promise)
    }
  }

  private fun startDownsample(source: String, side: Int, qualityInt: Int, operationId: String, promise: Promise) {
    assertUiThread()
    if (destroyed.get()) return
    if (activeOperation != null) {
      promise.reject("E_DOWNSAMPLE_BUSY", "Ya hay una reduccion de imagen en curso.")
      return
    }

    val context = reactApplicationContext
    val output = File(context.cacheDir, "impulsa-downsample-${UUID.randomUUID()}.jpg")
    val operation = Operation(operationId, output, promise)
    activeOperation = operation
    val options = RequestOptions()
      .override(side, side)
      .downsample(DownsampleStrategy.AT_MOST)
      .disallowHardwareConfig()
      .skipMemoryCache(true)
      .diskCacheStrategy(DiskCacheStrategy.NONE)

    val target = object : CustomTarget<Bitmap>(side, side) {
      override fun onResourceReady(resource: Bitmap, transition: Transition<in Bitmap>?) {
        assertUiThread()
        if (operation.settled.get() || operation.phase != Phase.LOADING || activeOperation !== operation) return
        if (destroyed.get() || operation.cancelRequested.get()) {
          finishLoadingCancellation(operation, operation.cancelPromise)
          return
        }
        operation.phase = Phase.PROCESSING
        val width = resource.width
        val height = resource.height
        try {
          compressionExecutor.execute {
            var processError: Throwable? = null
            try {
              check(Looper.myLooper() != Looper.getMainLooper()) {
                "La compresion JPEG no puede ejecutarse en el hilo principal."
              }
              FileOutputStream(output).use { stream ->
                if (!resource.compress(Bitmap.CompressFormat.JPEG, qualityInt, stream)) {
                  throw IllegalStateException("No se pudo comprimir la imagen.")
                }
              }
            } catch (error: Throwable) {
              processError = error
            }
            mainHandler.post {
              finishProcessing(operation, width, height, processError)
            }
          }
        } catch (error: RejectedExecutionException) {
          finishProcessing(operation, width, height, error)
        }
      }

      override fun onLoadFailed(errorDrawable: Drawable?) {
        super.onLoadFailed(errorDrawable)
        assertUiThread()
        if (!operation.settled.compareAndSet(false, true)) return
        operation.phase = Phase.FINISHED
        clearOperationTarget(operation)
        deleteOutput(operation)
        releaseOperation(operation)
        if (!destroyed.get()) {
          promise.reject("E_DOWNSAMPLE_READ", "No se pudo leer o decodificar la imagen seleccionada.")
        }
      }

      override fun onLoadCleared(placeholder: Drawable?) {
      }
    }
    operation.target = target

    try {
      Glide.with(context)
        .asBitmap()
        .load(Uri.parse(source))
        .apply(options)
        .into(target)
    } catch (error: Throwable) {
      if (operation.settled.compareAndSet(false, true)) {
        operation.phase = Phase.FINISHED
        clearOperationTarget(operation)
        deleteOutput(operation)
        releaseOperation(operation)
        if (!destroyed.get()) {
          promise.reject("E_DOWNSAMPLE_READ", "No se pudo leer o decodificar la imagen seleccionada.", error)
        }
      }
    }
  }

  private fun finishLoadingCancellation(operation: Operation, cancelPromise: Promise?) {
    assertUiThread()
    if (!operation.settled.compareAndSet(false, true)) {
      if (!destroyed.get()) cancelPromise?.resolve(false)
      return
    }
    operation.phase = Phase.FINISHED
    val cleared = clearOperationTarget(operation)
    deleteOutput(operation)
    releaseOperation(operation)
    if (!destroyed.get()) {
      operation.promise.reject("E_DOWNSAMPLE_CANCELLED", "La reduccion de la imagen fue cancelada.")
      cancelPromise?.resolve(cleared)
    }
  }

  private fun finishProcessing(operation: Operation, width: Int, height: Int, error: Throwable?) {
    assertUiThread()
    if (!operation.settled.compareAndSet(false, true)) return
    operation.phase = Phase.FINISHED
    val cancelled = operation.cancelRequested.get() || destroyed.get()
    if (cancelled || error != null) deleteOutput(operation)
    val cleared = clearOperationTarget(operation)
    releaseOperation(operation)

    if (destroyed.get()) return
    if (cancelled) {
      operation.promise.reject("E_DOWNSAMPLE_CANCELLED", "La reduccion de la imagen fue cancelada.")
      operation.cancelPromise?.resolve(cleared)
      return
    }
    if (error != null) {
      operation.promise.reject("E_DOWNSAMPLE_PROCESS", "No se pudo procesar la imagen reducida.", error)
      return
    }

    val result = Arguments.createMap()
    result.putString("uri", Uri.fromFile(operation.output).toString())
    result.putInt("width", width)
    result.putInt("height", height)
    operation.promise.resolve(result)
  }

  private fun releaseOperation(operation: Operation) {
    assertUiThread()
    if (activeOperation === operation) activeOperation = null
  }

  private fun clearOperationTarget(operation: Operation): Boolean {
    assertUiThread()
    if (!operation.targetCleared.compareAndSet(false, true)) return true
    val target = operation.target
    operation.target = null
    return clearTarget(target)
  }

  private fun deleteOutput(operation: Operation) {
    if (operation.outputDeleted.compareAndSet(false, true)) operation.output.delete()
  }

  private fun clearTarget(target: CustomTarget<Bitmap>?): Boolean {
    assertUiThread()
    if (target == null) return true
    return try {
      Glide.with(reactApplicationContext).clear(target)
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun runOnUiThread(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private fun assertUiThread() {
    check(Looper.myLooper() == Looper.getMainLooper()) {
      "La gestion de Glide debe ejecutarse en el hilo principal."
    }
  }

  override fun invalidate() {
    if (!destroyed.compareAndSet(false, true)) return
    compressionExecutor.shutdown()
    runOnUiThread {
      val operation = activeOperation ?: return@runOnUiThread
      when (operation.phase) {
        Phase.LOADING -> finishLoadingCancellation(operation, null)
        Phase.PROCESSING -> operation.cancelRequested.set(true)
        Phase.FINISHED -> Unit
      }
    }
    super.invalidate()
  }
}
