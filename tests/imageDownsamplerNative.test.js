const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.resolve(
  'android/app/src/main/java/com/integrat360/impulsa360/ImageDownsamplerModule.kt',
);
const source = fs.readFileSync(modulePath, 'utf8');

test('compresión y escritura están dentro del executor serial y fuera del callback UI directo', () => {
  assert.match(source, /Executors\.newSingleThreadExecutor/);
  const callbackStart = source.indexOf('override fun onResourceReady');
  const executorStart = source.indexOf('compressionExecutor.execute', callbackStart);
  const executorEnd = source.indexOf('} catch (error: RejectedExecutionException)', executorStart);
  assert.ok(callbackStart >= 0 && executorStart > callbackStart && executorEnd > executorStart);

  const callbackUi = source.slice(callbackStart, executorStart);
  const worker = source.slice(executorStart, executorEnd);
  assert.doesNotMatch(callbackUi, /FileOutputStream|resource\.compress/);
  assert.match(worker, /Looper\.myLooper\(\) != Looper\.getMainLooper\(\)/);
  assert.match(worker, /FileOutputStream/);
  assert.match(worker, /resource\.compress/);
});

test('cancelación durante procesamiento conserva target y exclusión hasta finalizar', () => {
  const processingCancel = source.slice(
    source.indexOf('if (operation.phase == Phase.PROCESSING)'),
    source.indexOf('finishLoadingCancellation(operation, promise)'),
  );
  assert.match(processingCancel, /operation\.cancelPromise = promise/);
  assert.doesNotMatch(processingCancel, /clearOperationTarget|releaseOperation|deleteOutput/);

  const finishProcessing = source.slice(
    source.indexOf('private fun finishProcessing'),
    source.indexOf('private fun releaseOperation'),
  );
  assert.match(finishProcessing, /deleteOutput\(operation\)/);
  assert.match(finishProcessing, /clearOperationTarget\(operation\)/);
  assert.match(finishProcessing, /releaseOperation\(operation\)/);
});

test('invalidación cierra el executor sin reciclar bitmaps en uso', () => {
  const invalidate = source.slice(source.indexOf('override fun invalidate()'));
  assert.match(invalidate, /destroyed\.compareAndSet\(false, true\)/);
  assert.match(invalidate, /compressionExecutor\.shutdown\(\)/);
  assert.match(invalidate, /Phase\.PROCESSING -> operation\.cancelRequested\.set\(true\)/);
  assert.doesNotMatch(source, /Bitmap\.recycle|\.recycle\(\)/);
});
