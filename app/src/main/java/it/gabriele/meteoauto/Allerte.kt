package it.gabriele.meteoauto

import org.json.JSONArray
import org.json.JSONObject

data class Allerta(val testo: String, val data: String?)

object Allerte {
    // Stessa Netlify Function usata dalla PWA: correggi il path se diverso
    private const val URL_ALLERTE =
        "https://dancing-zabaione-79d6bf.netlify.app/.netlify/functions/telegram"

    fun carica(): Allerta? {
        val body = Http.get(URL_ALLERTE).trim()
        val root: Any = if (body.startsWith("[")) JSONArray(body) else JSONObject(body)
        val post = mutableListOf<JSONObject>()
        raccogli(root, post)
        return post
            .filter { it.optString("text").contains("allert", ignoreCase = true) }
            .maxByOrNull { dataDi(it) ?: "" }
            ?.let { Allerta(it.optString("text").trim(), dataDi(it)) }
    }

    private fun dataDi(o: JSONObject): String? =
        listOf("date", "datetime", "time", "data").map { o.optString(it) }.firstOrNull { it.isNotBlank() }

    // Tollerante sulla forma del JSON: cerca ovunque oggetti con un campo "text"
    private fun raccogli(v: Any?, out: MutableList<JSONObject>) {
        when (v) {
            is JSONObject -> {
                if (v.optString("text").isNotBlank()) out.add(v)
                for (k in v.keys()) raccogli(v.opt(k), out)
            }
            is JSONArray -> for (i in 0 until v.length()) raccogli(v.opt(i), out)
        }
    }
}
