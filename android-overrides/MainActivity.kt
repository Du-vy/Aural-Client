package chat.aural.client

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Ajustar barra de estado y navegacion al tema oscuro de Aural (#0f151a)
    window.statusBarColor = Color.parseColor("#0f151a")
    window.navigationBarColor = Color.parseColor("#0f151a")

    // Ajustar contenido debajo de las barras de sistema de manera segura
    WindowCompat.setDecorFitsSystemWindows(window, true)

    // Solicitar permisos de grabacion de audio y notificaciones en tiempo de ejecucion
    val permissionsToRequest = mutableListOf<String>()
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      permissionsToRequest.add(Manifest.permission.RECORD_AUDIO)
      permissionsToRequest.add(Manifest.permission.MODIFY_AUDIO_SETTINGS)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
    }
    if (permissionsToRequest.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, permissionsToRequest.toTypedArray(), 1001)
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    // Conceder automaticamente permisos de captura de audio al WebView para llamadas de voz
    webView.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        runOnUiThread {
          request.grant(request.resources)
        }
      }
    }
  }
}
