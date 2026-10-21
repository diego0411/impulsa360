package com.integrat360.impulsa360

import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.net.Uri
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
import java.util.concurrent.atomic.AtomicBoolean

class ImageDownsamplerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private class Operation(
    val id: String,
    val output: File,
    val promise: Promise
  ) {
    val settled = AtomicBoolean(false)
    var target: CustomTarget<Bitmap>? = null
  }

  // Glide.clear cancela la entrega y libera el target en el hilo principal. No
  // interrumpe necesariamente un decoder que ya esta en curso, por eso no se
  // admite otra operacion hasta que la anterior haya sido completada o
  // cancelada. activeOperation solo se usa en el hilo principal.
  private var activeOperation: Operation? = null

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
      promise.reject("E_DOWNSAMPLE_ARGUMENT", "URI, operacion o parametros de reduccion invalidos.")
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
      promise.resolve(false)
      return
    }
    reactApplicationContext.runOnUiQueueThread {
      val operation = activeOperation
      if (operation == null || operation.id != id) {
        promise.resolve(false)
        return@runOnUiQueueThread
      }
      if (!operation.settled.compareAndSet(false, true)) {
        promise.resolve(false)
        return@runOnUiQueueThread
      }
      // Glide no interrumpe de forma cooperativa un decoder ya iniciado: clear
      // impide la entrega y libera el target. Si clear falla se informa false,
      // pero la operacion queda settled para que una entrega tardia no use el bitmap.
      val cleared = clearTarget(operation.target)
      operation.output.delete()
      releaseOperation(operation)
      operation.promise.reject("E_DOWNSAMPLE_CANCELLED", "La reduccion de la imagen fue cancelada.")
      promise.resolve(cleared)
    }
  }

  private fun startDownsample(source: String, side: Int, qualityInt: Int, operationId: String, promise: Promise) {
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
        if (!operation.settled.compareAndSet(false, true)) return
        try {
          FileOutputStream(output).use { stream ->
            if (!resource.compress(Bitmap.CompressFormat.JPEG, qualityInt, stream)) {
              throw IllegalStateException("No se pudo comprimir la imagen.")
            }
          }
          val result = Arguments.createMap()
          result.putString("uri", Uri.fromFile(output).toString())
          result.putInt("width", resource.width)
          result.putInt("height", resource.height)
          releaseOperation(operation)
          promise.resolve(result)
        } catch (error: Throwable) {
          output.delete()
          releaseOperation(operation)
          promise.reject("E_DOWNSAMPLE_PROCESS", "No se pudo procesar la imagen reducida.", error)
        } finally {
          clearTarget(this)
        }
      }

      override fun onLoadFailed(errorDrawable: Drawable?) {
        super.onLoadFailed(errorDrawable)
        if (!operation.settled.compareAndSet(false, true)) return
        clearTarget(this)
        output.delete()
        releaseOperation(operation)
        promise.reject("E_DOWNSAMPLE_READ", "No se pudo leer o decodificar la imagen seleccionada.")
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
        clearTarget(target)
        output.delete()
        releaseOperation(operation)
        promise.reject("E_DOWNSAMPLE_READ", "No se pudo leer o decodificar la imagen seleccionada.", error)
      }
    }
  }

  private fun releaseOperation(operation: Operation) {
    if (activeOperation === operation) activeOperation = null
  }

  private fun clearTarget(target: CustomTarget<Bitmap>?): Boolean {
    if (target == null) return true
    return try {
      Glide.with(reactApplicationContext).clear(target)
      true
    } catch (_: Throwable) {
      false
    }
  }
}
