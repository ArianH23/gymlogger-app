package com.gymlogger.watch.ui

import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme

// The phone app's "Dark" palette, so the watch looks like the same app: jade for actions, a little gold,
// green-tinted dark surfaces. The background stays pure black: it saves battery on the watch's screen.
val Jade = Color(0xFF45C08A)
val OnJade = Color(0xFF06130D)
val Gold = Color(0xFFC8A45C)
val Danger = Color(0xFFFF7A7A)

val GymColors = ColorScheme(
    primary = Jade,
    primaryDim = Color(0xFF2F9A6C),
    primaryContainer = Color(0xFF10261D),
    onPrimary = OnJade,
    onPrimaryContainer = Color(0xFFBFEBD6),
    secondary = Gold,
    secondaryDim = Color(0xFFA5863F),
    secondaryContainer = Color(0xFF2A2415),
    onSecondary = Color(0xFF1B1505),
    onSecondaryContainer = Color(0xFFEBD9AE),
    surfaceContainerLow = Color(0xFF131715),
    surfaceContainer = Color(0xFF1C2220),
    surfaceContainerHigh = Color(0xFF28302C),
    onSurface = Color(0xFFEEF0EC),
    onSurfaceVariant = Color(0xFF8E9992),
    outline = Color(0xFF5D6861),
    outlineVariant = Color(0xFF28302C),
    background = Color.Black,
    onBackground = Color(0xFFEEF0EC),
    error = Danger,
    onError = Color(0xFF2A0707),
)
