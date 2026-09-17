package chat.aural.client

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    window.statusBarColor = Color.BLACK
    window.navigationBarColor = Color.BLACK

    // En Android 15 (API 35+), edge-to-edge es obligatorio por defecto.
    // Desactivamos el decorFits para que el sistema despache insets a las vistas.
    WindowCompat.setDecorFitsSystemWindows(window, false)

    val insetsController = WindowCompat.getInsetsController(window, window.decorView)
    insetsController.isAppearanceLightStatusBars = false
    insetsController.isAppearanceLightNavigationBars = false

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

    webView.setBackgroundColor(Color.BLACK)

    // Ajustar margenes dinamicamente para que el WebView respete la barra de estado y notch
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val insets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      var topInset = insets.top
      if (topInset == 0) {
        val resourceId = resources.getIdentifier("status_bar_height", "dimen", "android")
        if (resourceId > 0) {
          topInset = resources.getDimensionPixelSize(resourceId)
        }
      }

      val params = view.layoutParams as? ViewGroup.MarginLayoutParams
      if (params != null) {
        if (params.topMargin != topInset || params.bottomMargin != insets.bottom ||
            params.leftMargin != insets.left || params.rightMargin != insets.right) {
          params.topMargin = topInset
          params.bottomMargin = insets.bottom
          params.leftMargin = insets.left
          params.rightMargin = insets.right
          view.layoutParams = params
        }
      }
      windowInsets
    }

    webView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) {
        ViewCompat.requestApplyInsets(v)
      }
      override fun onViewDetachedFromWindow(v: View) {}
    })

    ViewCompat.requestApplyInsets(webView)

    // Habilitar contenido mixto (ws:// y http:// hacia servidores autohospedados) y storage
    webView.settings.apply {
      mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
      domStorageEnabled = true
      databaseEnabled = true
    }

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
