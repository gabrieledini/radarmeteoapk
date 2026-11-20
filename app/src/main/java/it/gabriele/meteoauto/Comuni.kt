package it.gabriele.meteoauto

import android.content.SharedPreferences

data class Comune(val nome: String, val lat: Double, val lon: Double)

object Comuni {
    // In auto non si digita: elenco fisso, il primo è il default
    val elenco = listOf(
        Comune("Viareggio", 43.8657, 10.2513),
        Comune("Massarosa", 43.8670, 10.3420),
        Comune("Vecchiano", 43.7830, 10.3870),
        Comune("Camaiore", 43.9420, 10.3020),
        Comune("Pietrasanta", 43.9590, 10.2270),
        Comune("Forte dei Marmi", 43.9630, 10.1750),
        Comune("Lucca", 43.8430, 10.5050),
        Comune("Pisa", 43.7228, 10.4017),
        Comune("Livorno", 43.5485, 10.3106),
        Comune("Massa", 44.0354, 10.1393),
        Comune("Carrara", 44.0793, 10.0977),
        Comune("Pistoia", 43.9330, 10.9170),
        Comune("Prato", 43.8777, 11.1022),
        Comune("Firenze", 43.7696, 11.2558),
        Comune("Arezzo", 43.4633, 11.8796),
        Comune("Siena", 43.3188, 11.3308),
        Comune("Grosseto", 42.7635, 11.1124),
    )

    fun carica(p: SharedPreferences): Comune =
        elenco.firstOrNull { it.nome == p.getString("comune", null) } ?: elenco[0]

    fun salva(p: SharedPreferences, c: Comune) =
        p.edit().putString("comune", c.nome).apply()
}
