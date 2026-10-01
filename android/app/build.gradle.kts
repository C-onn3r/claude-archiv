plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.webarchiver"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.webarchiver"
        minSdk = 29 // Android 10+: Speichern in "Downloads" ohne Speicherberechtigung
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    // Feststehender Debug-Schlüssel (liegt im Repo): Debug-APKs von jedem Rechner lassen sich
    // über eine bereits installierte Version drüberinstallieren, ohne Daten zu verlieren.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true }

    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true // Robolectric braucht die App-Ressourcen
        unitTests.all {
            // Screenshot-Tests schreiben ihre Bilder nach app/build/screenshots (zur visuellen Prüfung der Oberfläche).
            it.systemProperty("roborazzi.test.record", "true")
            it.systemProperty("roborazzi.output.dir", layout.buildDirectory.dir("screenshots").get().asFile.absolutePath)
            it.jvmArgs("-Xmx2g")
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.androidx.test.core)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
