package it.gabriele.meteoauto

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

class MeteoCarAppService : CarAppService() {
    // Sviluppo/sideload: accetta qualsiasi host (Android Auto, DHU)
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = object : Session() {
        override fun onCreateScreen(intent: Intent): Screen = MeteoScreen(carContext)
    }
}
