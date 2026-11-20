package it.gabriele.meteoauto

import android.content.Context
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.*
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MeteoScreen(carContext: CarContext) : Screen(carContext) {
    private val scope = MainScope()
    private val prefs = carContext.getSharedPreferences("meteo", Context.MODE_PRIVATE)
    private var comune = Comuni.carica(prefs)
    private var meteo: Meteo? = null
    private var allerta: Allerta? = null
    private var errore: String? = null
    private var ora = ""
    private var job: Job? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) = scope.cancel()
        })
        aggiorna(primo = true)
        // Aggiornamento automatico ogni 15 minuti senza svuotare lo schermo
        scope.launch {
            while (isActive) {
                delay(15 * 60_000L)
                aggiorna(svuota = false)
            }
        }
    }

    private fun aggiorna(svuota: Boolean = true, primo: Boolean = false) {
        job?.cancel()
        if (svuota) {
            meteo = null; errore = null
            if (!primo) invalidate()
        }
        val c = comune
        job = scope.launch {
            try {
                val (m, a) = withContext(Dispatchers.IO) {
                    OpenMeteo.carica(c.lat, c.lon) to runCatching { Allerte.carica() }.getOrNull()
                }
                meteo = m; allerta = a; errore = null
                ora = SimpleDateFormat("HH:mm", Locale.ITALY).format(Date())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                errore = e.message ?: "Errore di rete"
            }
            invalidate()
        }
    }

    override fun onGetTemplate(): Template {
        val header = Header.Builder()
            .setTitle(comune.nome)
            .setStartHeaderAction(Action.APP_ICON)
            .addEndHeaderAction(
                Action.Builder().setTitle("Aggiorna").setOnClickListener { aggiorna() }.build()
            )
            .build()
        val tpl = ListTemplate.Builder().setHeader(header)
        val m = meteo
        if (m == null && errore == null) return tpl.setLoading(true).build()

        val lista = ItemList.Builder()
        errore?.let { lista.addItem(Row.Builder().setTitle("Errore").addText(it).build()) }

        allerta?.let { a ->
            lista.addItem(
                Row.Builder().setTitle("⚠ Allerta meteo")
                    .addText(a.data ?: "Canale @gianieugenio")
                    .setBrowsable(true)
                    .setOnClickListener { screenManager.push(AllertaScreen(carContext, a)) }
                    .build()
            )
        }

        if (m != null) {
            val a = m.attuale
            lista.addItem(
                Row.Builder()
                    .setTitle("${OpenMeteo.categoria(a.codice)} · ${a.temp.g()}°C")
                    .addText("Percepita ${a.percepita.g()}°C · umidità ${a.umidita}%")
                    .addText("${a.pressione.g()} hPa · agg. $ora")
                    .build()
            )
            lista.addItem(
                Row.Builder()
                    .setTitle("Vento ${a.vento.g()} km/h ${OpenMeteo.nomeVento(a.direzione)}")
                    .addText("Raffiche ${a.raffiche.g()} km/h")
                    .apply { m.onde?.let { addText("Onde %.1f m".format(Locale.ITALY, it)) } }
                    .build()
            )
            lista.addItem(
                Row.Builder().setTitle("Prossimi giorni")
                    .addText(m.giorni.drop(1).take(2).joinToString(" · ") {
                        "${OpenMeteo.giornoBreve(it.data)} ${OpenMeteo.categoria(it.codice)}"
                    })
                    .setBrowsable(true)
                    .setOnClickListener { screenManager.push(GiorniScreen(carContext, m.giorni)) }
                    .build()
            )
        }

        lista.addItem(
            Row.Builder().setTitle("Cambia comune")
                .setBrowsable(true)
                .setOnClickListener {
                    screenManager.pushForResult(ComuniScreen(carContext)) { r ->
                        (r as? Comune)?.let {
                            comune = it
                            Comuni.salva(prefs, it)
                            aggiorna()
                        }
                    }
                }
                .build()
        )
        return tpl.setSingleList(lista.build()).build()
    }
}

class GiorniScreen(carContext: CarContext, private val giorni: List<Giorno>) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        val lista = ItemList.Builder()
        giorni.forEach { g ->
            lista.addItem(
                Row.Builder()
                    .setTitle("${OpenMeteo.giornoBreve(g.data)} · ${OpenMeteo.categoria(g.codice)}")
                    .addText("${g.tMin.g()}/${g.tMax.g()}°C · vento max ${g.ventoMax.g()} km/h")
                    .setBrowsable(true)
                    .setOnClickListener { screenManager.push(GiornoScreen(carContext, g)) }
                    .build()
            )
        }
        return ListTemplate.Builder()
            .setSingleList(lista.build())
            .setHeader(Header.Builder().setTitle("Panoramica 4 giorni").setStartHeaderAction(Action.BACK).build())
            .build()
    }
}

class GiornoScreen(carContext: CarContext, private val g: Giorno) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        val lista = ItemList.Builder()
        g.fasce.forEach { f ->
            lista.addItem(Row.Builder().setTitle(f.nome).addText("${f.cielo} · ${f.tMedia.g()}°C").build())
        }
        return ListTemplate.Builder()
            .setSingleList(lista.build())
            .setHeader(Header.Builder().setTitle(OpenMeteo.giornoBreve(g.data)).setStartHeaderAction(Action.BACK).build())
            .build()
    }
}

class ComuniScreen(carContext: CarContext) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        val lista = ItemList.Builder()
        Comuni.elenco.forEach { c ->
            lista.addItem(
                Row.Builder().setTitle(c.nome)
                    .setOnClickListener { setResult(c); screenManager.pop() }
                    .build()
            )
        }
        return ListTemplate.Builder()
            .setSingleList(lista.build())
            .setHeader(Header.Builder().setTitle("Scegli comune").setStartHeaderAction(Action.BACK).build())
            .build()
    }
}

class AllertaScreen(carContext: CarContext, private val a: Allerta) : Screen(carContext) {
    override fun onGetTemplate(): Template =
        MessageTemplate.Builder(a.testo.take(500))
            .setTitle("Allerta meteo")
            .setHeaderAction(Action.BACK)
            .build()
}
