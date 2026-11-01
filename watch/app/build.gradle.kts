import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Where the app talks to. Set in watch/local.properties (never committed):
//   supabase.local.url / supabase.local.key   used by debug builds (the emulator reaches your PC at 10.0.2.2)
//   supabase.cloud.url / supabase.cloud.key   used by release builds (your real project; the key is the PUBLISHABLE one)
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(name: String, default: String = "") = localProps.getProperty(name, default)

android {
    namespace = "com.gymlogger.watch"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.gymlogger.watch"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        debug {
            buildConfigField("String", "SUPABASE_URL", "\"${prop("supabase.local.url", "http://10.0.2.2:54321")}\"")
            buildConfigField("String", "SUPABASE_KEY", "\"${prop("supabase.local.key", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH")}\"")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug") // fine for installing on your own watch
            buildConfigField("String", "SUPABASE_URL", "\"${prop("supabase.cloud.url")}\"")
            buildConfigField("String", "SUPABASE_KEY", "\"${prop("supabase.cloud.key")}\"")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.wear.compose:compose-material3:1.7.1")
    implementation("androidx.wear.compose:compose-foundation:1.7.1")
    implementation("androidx.wear.compose:compose-navigation:1.7.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
