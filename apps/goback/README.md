# GoBack

Save where you are, walk away, then let your Bangle.js 2 guide you back with an arrow and distance display. Perfect for finding your car, campsite, or trailhead.

---

## Quick Start

1. Open **GoBack** from the launcher.
2. **Tap the left side** ("SAVE HERE") — wait for "GPS READY", then tap to save.
3. Walk away and do your thing.
4. Open GoBack again, **tap the right side** ("FIND BACK").
5. Follow the arrow. The watch buzzes when you arrive.

That's it. Press the hardware button at any time to return to the clock — your saved location is kept.

---

## Detailed Guide

### Menu Screen

The main screen is split in two halves with a status bar at the top.

- **Top bar** shows GPS and compass status (animated dots while acquiring, "OK" when ready).
- **Left half** — tap to open the Save screen.
- **Right half** — tap to start navigating to a previously saved location. Shows the time it was saved. If nothing is saved yet, it says "no saved location".
- **Swipe down** — starts clearing the saved location. Swipe down again within 3 seconds to confirm.

### Save Screen

Shows satellite count, accuracy estimate, coordinates, and sample count.

- **GPS READY** (3+ samples collected) — tap to save an averaged position. The watch buzzes and returns to the clock.
- **GPS WAIT** (fewer than 3 samples) — you can still tap to save immediately. The app enters **estimation mode**: it starts navigating and back-calculates your starting point from the first few GPS fixes as you walk away. Just walk in a straight line until it locks on (a long buzz confirms).
- **No GPS yet** — same as above; tap to save anyway and it will estimate once a signal is found.

### Navigation Screen

The nav screen packs a lot of information:

| Area | Content |
|------|---------|
| **Top-left** | Battery % with drain estimate (e.g. "Batt:72% ~3h"). Turns red below 20%. |
| **Top-center** | "ON" when screen-on mode is active. |
| **Top-right** | Current time (HH:MM). |
| **Row 1** | Distance to target (metres, or km above 10 km). |
| **Row 2** | Cardinal direction to target (N, NE, E, …) with trend indicator: green **+** = getting closer, red **-** = getting further. A small colored bar on the left edge matches the trend. |
| **Row 3** | ETA (based on 30-second rolling average speed) and current speed in km/h. |
| **Center** | Direction arrow pointing toward your saved spot. |
| **Left bar** | Green = GPS fix acquired. No bar = no fix. |
| **Right bar** | Green = heading is reliable (compass locked or GPS course). No bar = compass still calibrating. |
| **Bottom** | Elapsed time since save, cardinal direction, GPS accuracy. |
| **Footer** | Control hints and "Sent to phone" confirmation. |

#### Arrow & heading source

- **Moving (>1 m/s)** — GPS course is blended with compass heading. The faster you move, the more GPS dominates. A label says "GPS heading (moving)".
- **Standing still** — compass heading is used. If it stabilises, the right bar turns green (heading locked) and the arrow is trustworthy.
- **Compass not ready** — the arrow is drawn in gray with "Calibrating compass… Rotate wrist in figure-8".
- **Close range (<20 m)** — bearing becomes unreliable. A shrinking circle appears around the arrow and the display says "Within ~Xm".

#### Trend & wrong-way warning

- A green bar + **"+"** next to the cardinal direction means you're closing in.
- A red bar + **"-"** means you're moving away.
- If you keep getting further for 5+ consecutive readings totalling >15 m, you get a **double buzz** warning.
- If you walk **>90° off course** for about 2 seconds (8 readings), you get a **triple-pulse buzz** and the screen wakes up.

#### Arrival

When you're within **5 metres**, the watch buzzes long, wakes the screen, and shows **ARRIVED!**. Tap to dismiss and keep navigating (useful if GPS jitter triggered it early). The arrival won't re-trigger until you move beyond 15 m and come back within 5 m again.

#### Battery

- Battery percentage is smoothed (EMA, updated every 30 seconds) to avoid display jitter.
- After a few minutes, a drain-rate estimate appears (e.g. "~3h" or "~45m" remaining).
- Below 20% the battery text turns red and a short buzz alerts you once.

### Estimation Mode

If you save before GPS is ready, the app doesn't give up — it enters estimation mode:

1. You start walking in a straight line.
2. As GPS fixes come in, the app tracks your speed and direction.
3. It back-projects your starting position based on how long ago you tapped save and how fast you were walking.
4. Once enough fixes are collected (3+), it calculates and saves the estimated origin. A long buzz confirms, and normal navigation begins.

The cap is 2 m/s × elapsed time, so it won't over-project if GPS jumps around.

### Open on Phone

During navigation, **swipe up** to send your saved location to your connected Android phone. It opens in your default maps app. "Sent to phone" appears briefly on screen.

### Screen-on Mode

By default the screen dims normally to save battery. **Swipe down** during navigation to toggle screen-on mode — a small **ON** appears at the top center. Swipe down again to turn it off. The normal timeout is always restored when leaving navigation or exiting the app.

### Clearing a Saved Location

On the menu screen, **swipe down** once to see "SWIPE AGAIN to clear!". Swipe down again within 3 seconds to delete the saved location. If you wait, the confirmation disappears.

---

## Controls

| Screen    | Action                | What happens                                      |
|-----------|-----------------------|---------------------------------------------------|
| Menu      | Tap left half         | Open Save screen                                  |
| Menu      | Tap right half        | Start navigation (if a location is saved)         |
| Menu      | Swipe down            | Clear saved location (swipe again within 3s to confirm) |
| Save      | Tap                   | Save position (or start estimation mode)          |
| Navigate  | Tap (1st)             | Shows "TAP AGAIN to exit!" (2s window)            |
| Navigate  | Tap (2nd within 2s)   | Return to menu (saved location is kept)           |
| Navigate  | Swipe up              | Open saved location on phone                      |
| Navigate  | Swipe down            | Toggle screen-on mode                             |
| Arrived   | Tap                   | Dismiss and keep navigating                       |
| Any       | Hardware button       | Return to clock (saved location is preserved)     |

## Alerts

| Alert             | Buzz pattern               | Trigger                                    |
|-------------------|----------------------------|--------------------------------------------|
| Wrong way         | Double buzz                | Getting further for 5+ readings (>15 m)    |
| Off course        | Triple pulse + screen wake | Walking >90° off bearing for ~2 seconds    |
| Arrived           | Long buzz + screen wake    | Within 5 m of saved point                  |
| Low battery       | Short buzz + red text      | Battery drops below 20%                    |
| Sent to phone     | Short buzz                 | Swipe up during navigation                 |
| Exit confirmation | Light buzz                 | First tap in nav mode                      |

## Tips

- **Go outside with clear sky** for best GPS accuracy. Buildings and dense forest reduce it.
- The accuracy estimate (e.g. "~8m") at the bottom of the nav screen is a rough guide.
- The arrow blends compass and GPS heading automatically — at walking speed the compass dominates; faster movement shifts to GPS course.
- Your saved location persists across reboots. Save today, navigate back tomorrow.
- The compass learns a magnetic declination offset from GPS over time, improving accuracy.

## Compatibility

Bangle.js 2 only.
