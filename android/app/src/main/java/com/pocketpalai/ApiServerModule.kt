package com.pocketpal

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeApiServerSpec
import java.io.BufferedInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * A small HTTP/1.1 server that lets other devices on the LAN drive the loaded
 * model.
 *
 * Transport only: it speaks HTTP, parses the request, hands the body to
 * JavaScript through one event and writes whatever JavaScript sends back. No
 * inference, no routing, no OpenAI semantics live here — that is
 * `src/services/apiServer`.
 *
 * Deliberately minimal so there is nothing to break:
 * - one request per connection (`Connection: close`), no keep-alive
 * - request bodies only via Content-Length (what curl and the OpenAI SDKs send);
 *   no chunked uploads
 * - responses are either a whole body or a stream of raw chunks (for SSE)
 */
@ReactModule(name = NativeApiServerSpec.NAME)
class ApiServerModule(reactContext: ReactApplicationContext) :
    NativeApiServerSpec(reactContext) {

  companion object {
    const val NAME = "ApiServerModule"
    private const val EVENT_REQUEST = "ApiServerRequest"
    private const val MAX_BODY_BYTES = 8 * 1024 * 1024
    private const val SOCKET_TIMEOUT_MS = 30_000
  }

  private var serverSocket: ServerSocket? = null
  private val running = AtomicBoolean(false)
  private val requestIds = AtomicInteger(0)
  private val pool = Executors.newCachedThreadPool()
  private val pending = ConcurrentHashMap<Int, Socket>()

  // Required by the EventEmitter contract the spec inherits; the request stream
  // itself is delivered through `emitDeviceEvent` (DeviceEventEmitter).
  override fun addListener(eventName: String) {}

  override fun removeListeners(count: Double) {}

  override fun invalidate() {
    stopInternal()
    super.invalidate()
  }

  override fun start(port: Double, promise: Promise) {
    if (running.get()) {
      promise.resolve(currentInfo())
      return
    }
    val bindPort = if (port <= 0) 0 else port.toInt()
    try {
      val socket = ServerSocket()
      socket.reuseAddress = true
      socket.bind(InetSocketAddress("0.0.0.0", bindPort))
      serverSocket = socket
      running.set(true)
      pool.execute { acceptLoop(socket) }
      promise.resolve(currentInfo())
    } catch (e: Exception) {
      stopInternal()
      promise.reject("E_API_SERVER_START", e.message, e)
    }
  }

  override fun stop(promise: Promise) {
    stopInternal()
    promise.resolve(null)
  }

  override fun getInfo(promise: Promise) {
    promise.resolve(currentInfo())
  }

  /** Whole response for `id`. Status line and headers are written here. */
  override fun respond(id: Double, status: Double, contentType: String, body: String) {
    val socket = pending.remove(id.toInt()) ?: return
    try {
      val bytes = body.toByteArray(Charsets.UTF_8)
      val out = socket.getOutputStream()
      writeHead(out, status.toInt(), contentType, bytes.size)
      out.write(bytes)
      out.flush()
    } catch (_: Exception) {
      // The client hung up; nothing to report to.
    } finally {
      closeQuietly(socket)
    }
  }

  /** Opens a response whose body arrives in pieces (SSE). */
  override fun beginStream(id: Double, status: Double, contentType: String): Boolean {
    val socket = pending.remove(id.toInt()) ?: return false
    return try {
      val out = socket.getOutputStream()
      writeHead(out, status.toInt(), contentType, -1)
      out.flush()
      streams[id.toInt()] = StreamHandle(socket, out)
      true
    } catch (_: Exception) {
      closeQuietly(socket)
      false
    }
  }

  override fun writeStreamChunk(id: Double, chunk: String) {
    val handle = streams[id.toInt()] ?: return
    try {
      // HTTP/1.1 chunked transfer encoding, one chunk per SSE event.
      val bytes = chunk.toByteArray(Charsets.UTF_8)
      val out = handle.out
      out.write(Integer.toHexString(bytes.size).toByteArray(Charsets.US_ASCII))
      out.write("\r\n".toByteArray(Charsets.US_ASCII))
      out.write(bytes)
      out.write("\r\n".toByteArray(Charsets.US_ASCII))
      out.flush()
    } catch (_: Exception) {
      endStream(id)
    }
  }

  override fun endStream(id: Double) {
    val handle = streams.remove(id.toInt()) ?: return
    try {
      val out = handle.out
      out.write("0\r\n\r\n".toByteArray(Charsets.US_ASCII))
      out.flush()
    } catch (_: Exception) {
      // ignore
    } finally {
      closeQuietly(handle.socket)
    }
  }

  private class StreamHandle(val socket: Socket, val out: OutputStream)

  private val streams = ConcurrentHashMap<Int, StreamHandle>()

  private fun acceptLoop(socket: ServerSocket) {
    while (running.get()) {
      val client = try {
        socket.accept()
      } catch (_: Exception) {
        break
      }
      pool.execute { handleConnection(client) }
    }
  }

  private fun handleConnection(client: Socket) {
    try {
      client.soTimeout = SOCKET_TIMEOUT_MS
      val input = BufferedInputStream(client.getInputStream())
      val head = readHead(input) ?: return closeQuietly(client)
      val lines = head.split("\r\n")
      val requestLine = lines.firstOrNull() ?: return closeQuietly(client)
      val parts = requestLine.split(" ")
      if (parts.size < 2) {
        return closeQuietly(client)
      }
      val method = parts[0]
      val path = parts[1]

      var contentLength = 0
      for (line in lines.drop(1)) {
        val idx = line.indexOf(':')
        if (idx <= 0) continue
        if (line.substring(0, idx).equals("Content-Length", ignoreCase = true)) {
          contentLength = line.substring(idx + 1).trim().toIntOrNull() ?: 0
        }
      }
      if (contentLength > MAX_BODY_BYTES) {
        respondRaw(client, 413, "Payload Too Large")
        return
      }
      val body = readBody(input, contentLength)

      val id = requestIds.incrementAndGet()
      pending[id] = client
      val payload: WritableMap = Arguments.createMap().apply {
        putInt("id", id)
        putString("method", method)
        putString("path", path)
        putString("body", body)
      }
      reactApplicationContext.emitDeviceEvent(EVENT_REQUEST, payload)

      // If JavaScript never answers (engine not loaded, handler threw), do not
      // leak the socket: the timeout in `respond` path covers it because the
      // socket is closed here only by respond/endStream.
    } catch (e: Exception) {
      closeQuietly(client)
    }
  }

  private fun readHead(input: InputStream): String? {
    val buffer = StringBuilder()
    var matched = 0
    while (true) {
      val b = input.read()
      if (b == -1) return null
      buffer.append(b.toChar())
      matched = when {
        b == '\r'.code && (matched == 0 || matched == 2) -> if (matched == 2) 3 else 1
        b == '\n'.code && matched == 1 -> 2
        b == '\r'.code && matched == 3 -> 4
        b == '\n'.code && matched == 4 -> return buffer.toString()
        else -> 0
      }
      if (buffer.length > 16 * 1024) return null
    }
  }

  private fun readBody(input: InputStream, length: Int): String {
    if (length <= 0) return ""
    val bytes = ByteArray(length)
    var read = 0
    while (read < length) {
      val n = input.read(bytes, read, length - read)
      if (n <= 0) break
      read += n
    }
    return String(bytes, 0, read, Charsets.UTF_8)
  }

  private fun writeHead(out: OutputStream, status: Int, contentType: String, length: Int) {
    val reason = when (status) {
      200 -> "OK"
      400 -> "Bad Request"
      404 -> "Not Found"
      405 -> "Method Not Allowed"
      413 -> "Payload Too Large"
      500 -> "Internal Server Error"
      else -> "OK"
    }
    val head = StringBuilder()
    head.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n")
    head.append("Content-Type: ").append(contentType).append("\r\n")
    head.append("Access-Control-Allow-Origin: *\r\n")
    head.append("Access-Control-Allow-Headers: *\r\n")
    head.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
    if (length >= 0) {
      head.append("Content-Length: ").append(length).append("\r\n")
    } else {
      head.append("Transfer-Encoding: chunked\r\n")
    }
    head.append("Cache-Control: no-store\r\n")
    head.append("Connection: close\r\n\r\n")
    out.write(head.toString().toByteArray(Charsets.US_ASCII))
  }

  private fun respondRaw(socket: Socket, status: Int, message: String) {
    try {
      val bytes = message.toByteArray(Charsets.UTF_8)
      val out = socket.getOutputStream()
      writeHead(out, status, "text/plain; charset=utf-8", bytes.size)
      out.write(bytes)
      out.flush()
    } catch (_: Exception) {
      // ignore
    } finally {
      closeQuietly(socket)
    }
  }

  private fun currentInfo(): WritableMap {
    val socket = serverSocket
    val map = Arguments.createMap()
    map.putBoolean("running", running.get() && socket != null)
    map.putInt("port", socket?.localPort ?: 0)
    val urls = Arguments.createArray()
    if (socket != null) {
      for (address in lanAddresses()) {
        urls.pushString("http://$address:${socket.localPort}")
      }
    }
    map.putArray("urls", urls)
    return map
  }

  /** IPv4 addresses of up interfaces; loopback excluded — the point is the LAN. */
  private fun lanAddresses(): List<String> {
    val out = mutableListOf<String>()
    try {
      for (iface in Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!iface.isUp || iface.isLoopback) continue
        for (addr in Collections.list(iface.inetAddresses)) {
          if (addr is Inet4Address && !addr.isLoopbackAddress) {
            val host = addr.hostAddress ?: continue
            out.add(host)
          }
        }
      }
    } catch (_: Exception) {
      // Interface enumeration is best-effort.
    }
    return out.distinct().sorted()
  }

  private fun stopInternal() {
    running.set(false)
    try {
      serverSocket?.close()
    } catch (_: Exception) {
      // ignore
    }
    serverSocket = null
    for (id in pending.keys) {
      pending.remove(id)?.let { closeQuietly(it) }
    }
    for (id in streams.keys) {
      endStream(id.toDouble())
    }
  }

  private fun closeQuietly(socket: Socket) {
    try {
      socket.close()
    } catch (_: Exception) {
      // ignore
    }
  }
}
