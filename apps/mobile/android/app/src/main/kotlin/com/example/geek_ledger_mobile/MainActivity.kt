package com.example.geek_ledger_mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
  companion object {
    private const val CHANNEL = "geek_ledger/platform"
    private const val REQ_OPEN_JSON = 4101
    private const val REQ_CREATE_JSON = 4102
  }

  private var pendingResult: MethodChannel.Result? = null
  private var pendingSaveContent: String? = null
  private var pendingSaveFileName: String? = null

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
      .setMethodCallHandler { call, result ->
        when (call.method) {
          "getStoragePath" -> {
            val file = File(filesDir, "geek_ledger_state.json")
            result.success(file.absolutePath)
          }
          "pickJsonFile" -> {
            if (pendingResult != null) {
              result.error("BUSY", "文件选择器已打开，请先完成当前操作", null)
              return@setMethodCallHandler
            }
            pendingResult = result
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
              addCategory(Intent.CATEGORY_OPENABLE)
              type = "*/*"
              putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf(
                  "application/json",
                  "text/json",
                  "text/plain",
                  "application/octet-stream",
                ),
              )
            }
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQ_OPEN_JSON)
          }
          "saveJsonFile" -> {
            if (pendingResult != null) {
              result.error("BUSY", "文件保存器已打开，请先完成当前操作", null)
              return@setMethodCallHandler
            }
            val content = call.argument<String>("content") ?: ""
            val fileName = call.argument<String>("fileName") ?: "geek_ledger_backup.json"
            pendingResult = result
            pendingSaveContent = content
            pendingSaveFileName = fileName
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
              addCategory(Intent.CATEGORY_OPENABLE)
              type = "application/json"
              putExtra(Intent.EXTRA_TITLE, fileName)
            }
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQ_CREATE_JSON)
          }
          else -> result.notImplemented()
        }
      }
  }

  private fun queryFileName(uri: Uri): String? {
    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor ->
        if (cursor.moveToFirst()) {
          val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (idx >= 0) return cursor.getString(idx)
        }
      }
    return uri.lastPathSegment
  }

  @Deprecated("Deprecated in Java")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    @Suppress("DEPRECATION")
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQ_OPEN_JSON && requestCode != REQ_CREATE_JSON) return
    val callback = pendingResult ?: return
    val saveContent = pendingSaveContent
    val saveName = pendingSaveFileName
    pendingResult = null
    pendingSaveContent = null
    pendingSaveFileName = null

    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      callback.success(null)
      return
    }
    val uri = data.data!!
    try {
      if (requestCode == REQ_OPEN_JSON) {
        val raw = contentResolver.openInputStream(uri)?.use { stream ->
          stream.bufferedReader(Charsets.UTF_8).readText()
        } ?: throw IllegalStateException("无法读取所选文件内容")
        val cleaned = raw.removePrefix("\uFEFF")
        callback.success(
          mapOf(
            "name" to (queryFileName(uri) ?: "backup.json"),
            "content" to cleaned,
          ),
        )
      } else {
        contentResolver.openOutputStream(uri, "wt")?.use { stream ->
          stream.write((saveContent ?: "").toByteArray(Charsets.UTF_8))
          stream.flush()
        } ?: throw IllegalStateException("无法写入目标文件")
        callback.success(
          mapOf(
            "name" to (queryFileName(uri) ?: (saveName ?: "geek_ledger_backup.json")),
          ),
        )
      }
    } catch (e: Exception) {
      callback.error("IO_ERROR", e.message ?: e.toString(), null)
    }
  }
}
