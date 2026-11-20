package it.gabriele.meteoauto

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale

data class Attuale(
    val temp: Double, val percepita: Double, val umidita: Int, val vento: Double,
    val raffiche: Double, val direzione: Int, val pressione: Double, val codice: Int
)
data class Fascia(val nome: String, val cielo: String, val tMedia: Double)
data class Giorno(
    val data: String, val codice: Int, val tMin: Double, val tMax: Double,
    val ventoMax: Double, val fasce: List<Fascia>
)
data class Meteo(val attuale: Attuale, val onde: Double?, val giorni: List<Giorno>)

fun Double.g(): String = if (isNaN()) "--" else Math.round(this).toString()

object Http {
    fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 10_000
        try {
            if (c.responseCode !in 200..299) throw IOException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }
}

object OpenMeteo {
    private val FASCE = listOf("Mattina" to 6..11, "Pomeriggio" to 12..17, "Sera" to 18..23)

    fun carica(lat: Double, lon: Double): Meteo {
        val url = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
            "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m," +
            "wind_direction_10m,wind_gusts_10m,pressure_msl,weather_code" +
            "&hourly=temperature_2m,weather_code" +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max" +
            "&timezone=Europe%2FRome&forecast_days=4"
        val j = JSONObject(Http.get(url))

        val c = j.getJSONObject("current")
        val attuale = Attuale(
            c.getDouble("temperature_2m"), c.getDouble("apparent_temperature"),
            c.getInt("relative_humidity_2m"), c.getDouble("wind_speed_10m"),
            c.getDouble("wind_gusts_10m"), c.getInt("wind_direction_10m"),
            c.getDouble("pressure_msl"), c.getInt("weather_code")
        )

        val h = j.getJSONObject("hourly")
        val hTime = h.getJSONArray("time")
        val hTemp = h.getJSONArray("temperature_2m")
        val hCode = h.getJSONArray("weather_code")

        val d = j.getJSONObject("daily")
        val dTime = d.getJSONArray("time")
        val giorni = (0 until dTime.length()).map { i ->
            val data = dTime.getString(i)
            val fasce = FASCE.map { (nome, ore) ->
                val idx = (0 until hTime.length()).filter { k ->
                    val t = hTime.getString(k)
                    t.startsWith(data) && t.substring(11, 13).toInt() in ore
                }
                val cielo = idx.map { categoria(hCode.optInt(it)) }
                    .groupingBy { it }.eachCount().maxByOrNull { it.value }?.key ?: "--"
                val media = if (idx.isEmpty()) Double.NaN else idx.map { hTemp.optDouble(it) }.average()
                Fascia(nome, cielo, media)
            }
            Giorno(
                data,
                d.getJSONArray("weather_code").optInt(i),
                d.getJSONArray("temperature_2m_min").optDouble(i),
                d.getJSONArray("temperature_2m_max").optDouble(i),
                d.getJSONArray("wind_speed_10m_max").optDouble(i),
                fasce
            )
        }

        // Per i comuni dell'interno il modello marino non ha dati: onde = null
        val onde = runCatching {
            JSONObject(Http.get("https://marine-api.open-meteo.com/v1/marine?latitude=$lat&longitude=$lon&current=wave_height"))
                .getJSONObject("current").getDouble("wave_height")
        }.getOrNull()

        return Meteo(attuale, onde, giorni)
    }

    fun categoria(code: Int): String = when (code) {
        0, 1 -> "Sereno"
        2 -> "Poco nuvoloso"
        3 -> "Coperto"
        45, 48 -> "Nebbia"
        in 51..57 -> "Pioviggine"
        in 61..67, in 80..82 -> "Pioggia"
        in 71..77, 85, 86 -> "Neve"
        in 95..99 -> "Temporale"
        else -> "--"
    }

    fun nomeVento(gradi: Int): String {
        val nomi = listOf("Tramontana", "Grecale", "Levante", "Scirocco",
            "Mezzogiorno", "Libeccio", "Ponente", "Maestrale")
        return nomi[(((gradi % 360) + 22.5) / 45).toInt() % 8]
    }

    fun giornoBreve(data: String): String = runCatching {
        val d = SimpleDateFormat("yyyy-MM-dd", Locale.ITALY).parse(data)!!
        SimpleDateFormat("EEE d/MM", Locale.ITALIAN).format(d)
    }.getOrDefault(data)
}
