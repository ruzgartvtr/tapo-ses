package com.ruzgar.taposes

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

fun discoverCameraAddresses(context: Context): List<String> {
    val local = phoneIpv4(context) ?: return emptyList()
    val prefix = local.substringBeforeLast('.')
    if (prefix.count { it == '.' } != 2) return emptyList()
    val found = Collections.synchronizedList(mutableListOf<String>())
    val pool = Executors.newFixedThreadPool(48)
    for (host in 1..254) {
        val ip = "$prefix.$host"
        if (ip == local) continue
        pool.execute {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(ip, 8800), 220)
                    found.add(ip)
                }
            } catch (_: Exception) {
            }
        }
    }
    pool.shutdown()
    pool.awaitTermination(4, TimeUnit.SECONDS)
    return found.sorted()
}

private fun phoneIpv4(context: Context): String? {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = manager.activeNetwork ?: return null
    val capabilities = manager.getNetworkCapabilities(network)
    if (capabilities != null &&
        !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
        !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    ) {
        return null
    }
    val addresses = manager.getLinkProperties(network)?.linkAddresses.orEmpty()
    return addresses
        .map { it.address }
        .filterIsInstance<Inet4Address>()
        .firstOrNull { !it.isLoopbackAddress }
        ?.hostAddress
}
