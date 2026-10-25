package com.kolyagames.corsamess

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.IOException
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import android.util.Base64

/**
 * corsa-mess для Android — подключение к комнатам поверх самоподписанных сертификатов.
 *
 * Серверы комнат (desktop-клиент corsa-mess) используют самоподписанный сертификат с общим
 * CN=corsa-mess и не меняющимся отпечатком. Обычный WebView не умеет доверять такому сертификату,
 * а полностью отключать проверку TLS — дыра в безопасности. Вместо этого здесь, как и в
 * desktop-версии (app/main.js, setupCertificates), сделано доверие по первому подключению
 * (trust-on-first-use): отпечаток сертификата запоминается при первом заходе и сверяется при
 * следующих. Если он изменился — соединение блокируется. Хранилище отпечатков зашифровано
 * средствами Android Keystore (EncryptedSharedPreferences), как hostPassword на столе шифруется
 * через safeStorage.
 */
@CapacitorPlugin(name = "CorsaNative")
class CorsaNativePlugin : Plugin() {

    private lateinit var pinStore: PinStore
    private lateinit var secretStore: PinStore
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    override fun load() {
        pinStore = PinStore(context, "corsa_tls_pins")
        secretStore = PinStore(context, "corsa_secrets")
        ensureChannel()
    }

    // ---------- Закрепление сертификатов (TLS pinning) ----------

    @PluginMethod
    fun tlsPins(call: PluginCall) {
        val arr = com.getcapacitor.JSArray()
        for ((host, fp) in pinStore.all()) {
            val o = JSObject()
            o.put("host", host)
            o.put("fingerprint", fp)
            arr.put(o)
        }
        val ret = JSObject()
        ret.put("pins", arr)
        call.resolve(ret)
    }

    @PluginMethod
    fun tlsForget(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("host required")
        pinStore.remove(host)
        call.resolve()
    }

    // ---------- WebSocket к серверу комнаты (замена window.WebSocket для wss:// с самоподписанным сертификатом) ----------

    @PluginMethod
    fun wsOpen(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val url = call.getString("url") ?: return call.reject("url required")
        val host = call.getString("host") ?: return call.reject("host required")
        val port = call.getInt("port") ?: return call.reject("port required")

        val client = pinnedClient(host, port)
        val request = Request.Builder().url(url).build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                emit(id, "open", null, null)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                emit(id, "message", text, null)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                emit(id, "message", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP), "binary")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                sockets.remove(id)
                emit(id, "close", reason, null)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                sockets.remove(id)
                emit(id, "error", t.message ?: "Ошибка соединения", null)
            }
        })
        sockets[id] = ws
        call.resolve()
    }

    @PluginMethod
    fun wsSend(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val data = call.getString("data") ?: return call.reject("data required")
        val ws = sockets[id] ?: return call.reject("socket closed")
        ws.send(data)
        call.resolve()
    }

    @PluginMethod
    fun wsClose(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        sockets.remove(id)?.close(1000, null)
        call.resolve()
    }

    private fun emit(id: String, type: String, data: String?, kind: String?) {
        val o = JSObject()
        o.put("id", id)
        o.put("type", type)
        if (data != null) o.put("data", data)
        if (kind != null) o.put("kind", kind)
        notifyListeners("wsEvent", o)
    }

    // ---------- Загрузка и скачивание файлов комнаты (тоже через закреплённый сертификат) ----------

    @PluginMethod
    fun httpUpload(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("host required")
        val port = call.getInt("port") ?: return call.reject("port required")
        val token = call.getString("token") ?: return call.reject("token required")
        val name = call.getString("name") ?: "файл"
        val type = call.getString("type") ?: "application/octet-stream"
        val voice = call.getBoolean("voice") ?: false
        val dur = call.getInt("dur") ?: 0
        val base64 = call.getString("data") ?: return call.reject("data required")
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        if (bytes.size > 25 * 1024 * 1024) return call.reject("Файл больше 25 МБ")

        val client = pinnedClient(host, port)
        val body = bytes.toRequestBody(type.toMediaTypeOrNull())
        val req = Request.Builder()
            .url("https://$host:$port/upload")
            .header("X-Corsa-Token", token)
            .header("X-Corsa-Name", java.net.URLEncoder.encode(name.take(120), "UTF-8"))
            .header("X-Corsa-Voice", if (voice) "1" else "0")
            .header("X-Corsa-Duration", dur.toString())
            .post(body)
            .build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call2: Call, e: IOException) { call.reject(e.message ?: "Ошибка сети") }
            override fun onResponse(call2: Call, response: Response) {
                response.use {
                    val text = it.body?.string() ?: ""
                    if (!it.isSuccessful) { call.reject(text.ifBlank { "ошибка ${it.code}" }); return }
                    try { call.resolve(JSObject(text)) } catch (e: Exception) { call.reject("Некорректный ответ сервера") }
                }
            }
        })
    }

    @PluginMethod
    fun httpFetch(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("host required")
        val port = call.getInt("port") ?: return call.reject("port required")
        val token = call.getString("token") ?: return call.reject("token required")
        val fileId = call.getString("fileId") ?: return call.reject("fileId required")

        val client = pinnedClient(host, port)
        val req = Request.Builder()
            .url("https://$host:$port/f/$fileId")
            .header("X-Corsa-Token", token)
            .build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call2: Call, e: IOException) { call.reject(e.message ?: "Файл недоступен") }
            override fun onResponse(call2: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) { call.reject("Файл удалён или недоступен"); return }
                    val bytes = it.body?.bytes() ?: ByteArray(0)
                    val ret = JSObject()
                    ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    ret.put("contentType", it.header("Content-Type") ?: "application/octet-stream")
                    call.resolve(ret)
                }
            }
        })
    }

    private fun pinnedClient(host: String, port: Int): OkHttpClient {
        val trustManager = CorsaTrustManager(pinStore, host, port) { kind, h, fp ->
            val o = JSObject()
            o.put("kind", kind)
            o.put("host", h)
            o.put("fingerprint", fp)
            notifyListeners("tlsEvent", o)
        }
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf<TrustManager>(trustManager), null)
        return http.newBuilder()
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            // Сертификат — общий CN=corsa-mess, не для конкретного хоста/IP: имя хоста намеренно не
            // сверяется с сертификатом, доверие строится на закреплении отпечатка выше (как на столе).
            .hostnameVerifier(HostnameVerifier { _, _ -> true })
            .build()
    }

    // ---------- Секреты (аналог Electron safeStorage; сейчас используется только для пароля своей комнаты) ----------

    @PluginMethod
    fun secretSet(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        val value = call.getString("value") ?: ""
        if (value.isEmpty()) secretStore.remove(key) else secretStore.put(key, value)
        call.resolve()
    }

    @PluginMethod
    fun secretGet(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        val ret = JSObject()
        ret.put("value", secretStore.get(key) ?: "")
        call.resolve(ret)
    }

    // ---------- Уведомления ----------

    @PluginMethod
    fun notifyShow(call: PluginCall) {
        val title = call.getString("title") ?: "corsa-mess"
        val body = call.getString("body") ?: ""
        val tag = call.getString("tag") ?: ""
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        nm.notify(tag.hashCode(), builder.build())
        call.resolve()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(CHANNEL_ID, "Сообщения corsa-mess", NotificationManager.IMPORTANCE_DEFAULT)
            nm.createNotificationChannel(channel)
        }
    }

    companion object {
        private const val CHANNEL_ID = "corsa_messages"
    }
}

/** Доверенный менеджер TLS с закреплением отпечатка по ключу host:port (trust-on-first-use). */
private class CorsaTrustManager(
    private val store: PinStore,
    private val host: String,
    private val port: Int,
    private val onEvent: (String, String, String) -> Unit,
) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        if (chain.isEmpty()) throw CertificateException("Пустая цепочка сертификатов")
        val cert = chain[0]
        val subject = cert.subjectX500Principal.name
        if (!subject.contains("corsa-mess")) throw CertificateException("Это не сертификат corsa-mess")
        val fp = fingerprint(cert)
        val key = "$host:$port"
        var expected = store.get(key)
        if (expected == null && store.get(host) != null) {
            val legacy = store.get(host)!!
            if (legacy == fp) { store.put(key, fp); return } else expected = legacy
        }
        if (expected == null) {
            store.put(key, fp)
            onEvent("new", key, fp)
        } else if (expected != fp) {
            onEvent("mismatch", key, fp)
            throw CertificateException("Отпечаток сертификата изменился — возможна подмена сервера")
        }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()

    private fun fingerprint(cert: X509Certificate): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
        return digest.joinToString(":") { "%02X".format(it) }
    }
}

/** Небольшое зашифрованное key-value хранилище поверх Android Keystore. */
private class PinStore(context: Context, fileName: String) {
    private val prefs = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context, fileName, masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun get(key: String): String? = prefs.getString(key, null)
    fun put(key: String, value: String) { prefs.edit().putString(key, value).apply() }
    fun remove(key: String) { prefs.edit().remove(key).apply() }
    fun all(): Map<String, String> {
        val out = HashMap<String, String>()
        for ((k, v) in prefs.all) if (v is String) out[k] = v
        return out
    }
}
