var storage = require("Storage");

// Auto-create icon if missing
if (!storage.read("goback.img")) {
  storage.write("goback.img", atob("MDBCAAD//wfghBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAqoAAAAAAAAAAAAAAqoAAAAAAAAAAAAACqqAAAAAAAAAAAAAAqoAAAAAAAAAAAAAAqoAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAFQAAAAAAAAAAAAAAFQAAAAAAAAAAAAAAFQAAAAAAAAAAAAAAFQAAAAAAAAAAAAAAVUAAAAAAAAAAAAAAVUAAAAAAAAAAAAAFVVQAAAAAAAAAAABVVVVAAAAAAAAAAAFVVVVQAAAAAAAAAAFRVVFQAAAAAAAAAAVBVVBUAAAAAAAAAAVBVVBUAAAAAAAAABUBVVAVAAAAAAAAABUFVVQVAAAAAAAAABUFVVQVAAAAAAAAABUFVVQVAAAAAAAAABUFVVQVAAAAAAAAAAVVVVVUAAAAAAAAAAVVVVVUAAAAAAAAAAFVVVVQAAAAAAAAAAFVVVVQAAAAAAAAAABVVVVAAAAAAAAAAABVVVVAAAAAAAAAAABVVVVAAAAAAAAAAABVVVVAAAAAAAAAAAFVVVVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
}

var savedData = storage.readJSON("goback.json", true) || null;
var origLCDTimeout = (storage.readJSON("setting.json", true) || {}).timeout || 10;
var lastFix = null;
var heading = 0;
var speed = 0; // m/s
var mode = "menu"; // "menu", "save", "navigate"
var arrived = false;
var arrivedDismissed = false; // true after user dismissed ARRIVED, prevents re-trigger
var fixHistory = []; // store recent good fixes for averaging
var MAX_HISTORY = 10;
var saveTime = 0; // timestamp when user tapped save
var trackLog = []; // GPS fixes after save for back-estimation
var MAX_TRACK_LOG = 20;
var estimating = false; // true if we saved with poor GPS
var clearConfirm = false; // confirmation state for clearing
var confirmTimer = null;
var magSamples = []; // recent heading samples for calibration check
var compassReady = false;
var smoothHeading = null; // smoothed heading for display
var smoothHistory = []; // recent smoothed headings to detect convergence
var HEADING_SMOOTH = 0.35; // smoothing factor (0=no change, 1=no smoothing)
var MIN_SAMPLES = 15; // minimum readings before compass can be ready
var smoothGpsCourse = null; // smoothed GPS course
var useGps = false; // true when using GPS course instead of compass
var magDeclination = 0; // learned compass offset (magnetic to true north)
var declinationSamples = []; // differences between GPS course and compass
var declinationSum = 0; // running sum for averaging
var posHistory = []; // recent GPS positions for averaged bearing (with weights)
var MAX_POS_HISTORY = 5;
var lastPosTime = 0; // timestamp of last accepted position
var blendedHeading = null; // final blended heading for display
var CLOSE_RANGE = 20; // meters - below this, bearing is unreliable
var lastDist = null; // previous distance for trend indicator
var savedTimeStr = ""; // cached formatted saved time
var gpsMeasCount = 0; // increments on every GPS event received
var magMeasCount = 0; // increments on every compass event received
var wrongWayCount = 0; // consecutive readings getting further away
var wrongWayDist = 0; // distance gained since wrong-way started
var wrongWayWarned = false; // true after buzzing, resets when closer
var wrongWayTimer = null; // timeout for double-buzz
var CARDINAL_DIRS = ["N","NE","E","SE","S","SW","W","NW"];
var lastGpsTime = 0; // timestamp of last GPS course update
var GPS_STALE_MS = 2000; // fall back to compass if no GPS course for 2s
var keepScreenOn = false; // toggle with swipe down in nav mode
var navExitConfirm = false; // tap-again-to-exit state
var navExitTimer = null; // timeout for exit confirmation
var speedHistory = []; // {speed, time} for rolling average
var sentToPhone = false; // brief "Sent to phone" display flag
var sentToPhoneTimer = null;
var exiting = false; // prevent double exitApp calls
var offCourseCount = 0; // consecutive readings >90° off bearing
var offCourseWarned = false; // true after off-course buzz
var lowBattWarned = false; // true after low battery buzz
var stationaryHeadings = []; // recent headings while still, for lock detection
var headingLocked = false; // true when standing still with stable heading
var battSmooth = E.getBattery();
var battLastUpdate = Date.now();
var battStartLevel = battSmooth;
var battStartTime = Date.now();

function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

function angleDiff(a, b) {
  var d = a - b;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function smoothAngle(current, target, factor) {
  if (current === null) return target;
  var diff = angleDiff(target, current);
  return (current + diff * factor + 360) % 360;
}

function getDistance(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearing(lat1, lon1, lat2, lon2) {
  var dLon = toRad(lon2 - lon1);
  var y = Math.sin(dLon) * Math.cos(toRad(lat2));
  var x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
          Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function projectPoint(lat, lon, bearing, dist) {
  var R = 6371000;
  var d = dist / R;
  var brng = toRad(bearing);
  var lat1 = toRad(lat);
  var lon1 = toRad(lon);
  var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) +
             Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  var lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
             Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

function estimateOrigin() {
  if (trackLog.length < 3) return null;
  var first = trackLog[0];
  var last = trackLog[Math.min(trackLog.length - 1, 5)];
  var dist = getDistance(first.lat, first.lon, last.lat, last.lon);
  var dt = (last.time - first.time) / 1000;
  if (dt < 1) return null;
  var spd = dist / dt;
  var walkBearing = getBearing(first.lat, first.lon, last.lat, last.lon);
  var reverseBearing = (walkBearing + 180) % 360;
  var timeSinceSave = (first.time - saveTime) / 1000;
  var distBack = spd * timeSinceSave;
  if (distBack > timeSinceSave * 2) distBack = timeSinceSave * 2;
  return projectPoint(first.lat, first.lon, reverseBearing, distBack);
}

function openOnPhone() {
  if (!savedData) return;
  Bluetooth.println(JSON.stringify({
    t: "intent",
    target: "activity",
    action: "android.intent.action.VIEW",
    uri: "geo:" + savedData.lat + "," + savedData.lon + "?q=" + savedData.lat + "," + savedData.lon
  }));
  Bangle.buzz(100);
  sentToPhone = true;
  if (sentToPhoneTimer) clearTimeout(sentToPhoneTimer);
  sentToPhoneTimer = setTimeout(function() { sentToPhone = false; sentToPhoneTimer = null; draw(); }, 2000);
  draw();
}

function drawArrow(cx, cy, angle, len) {
  var rad = toRad(angle);
  var tipX = cx + len * Math.sin(rad);
  var tipY = cy - len * Math.cos(rad);
  var baseX1 = cx + (len * 0.5) * Math.sin(rad + Math.PI * 0.8);
  var baseY1 = cy - (len * 0.5) * Math.cos(rad + Math.PI * 0.8);
  var baseX2 = cx + (len * 0.5) * Math.sin(rad - Math.PI * 0.8);
  var baseY2 = cy - (len * 0.5) * Math.cos(rad - Math.PI * 0.8);
  // Thick outline for sunlight visibility
  var olLen = len + 3;
  var oTipX = cx + olLen * Math.sin(rad);
  var oTipY = cy - olLen * Math.cos(rad);
  var oBaseX1 = cx + ((len * 0.5) + 3) * Math.sin(rad + Math.PI * 0.8);
  var oBaseY1 = cy - ((len * 0.5) + 3) * Math.cos(rad + Math.PI * 0.8);
  var oBaseX2 = cx + ((len * 0.5) + 3) * Math.sin(rad - Math.PI * 0.8);
  var oBaseY2 = cy - ((len * 0.5) + 3) * Math.cos(rad - Math.PI * 0.8);
  g.setColor(0, 0, 0);
  g.fillPoly([oTipX, oTipY, oBaseX1, oBaseY1, oBaseX2, oBaseY2]);
  g.setColor(1, 1, 1);
  g.fillPoly([tipX, tipY, baseX1, baseY1, baseX2, baseY2]);
}

function formatDist(m) {
  if (m >= 10000) return (m / 1000).toFixed(1) + "km";
  return Math.round(m) + "m";
}

function cardinalDir(deg) {
  return CARDINAL_DIRS[Math.round(deg / 45) % 8];
}

function updateSavedTimeStr() {
  if (savedData && savedData.time) {
    var t = new Date(savedData.time);
    savedTimeStr = t.getHours() + ":" + (t.getMinutes() < 10 ? "0" : "") + t.getMinutes();
  } else {
    savedTimeStr = "?";
  }
}
updateSavedTimeStr();

function drawMenuScreen() {
  g.clear();
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  g.drawString("SAVE", 44, 55);
  g.drawString("HERE", 44, 75);
  g.drawLine(88, 20, 88, 140);
  if (savedData) {
    g.drawString("FIND", 132, 55);
    g.drawString("BACK", 132, 75);
    g.setFont("6x8", 1);
    if (savedTimeStr) g.drawString("(" + savedTimeStr + ")", 132, 95);
  } else {
    g.setFont("6x8", 1);
    g.drawString("no saved", 132, 65);
    g.drawString("location", 132, 77);
  }
  g.setFont("6x8", 1);
  g.setFontAlign(0, 0);
  if (savedData) {
    if (clearConfirm) {
      g.drawString("SWIPE AGAIN to clear!", 88, 153);
    } else {
      g.drawString("Swipe down = clear saved", 88, 153);
    }
  }
  g.drawString("<- left | right ->", 88, 168);
  g.setFont("6x8", 1);
  var gpsDots = [".", "..", "..."][gpsMeasCount % 3];
  var magDots = [".", "..", "..."][magMeasCount % 3];
  var gpsStatus = (lastFix && lastFix.fix) ? "GPS:OK" : "GPS" + gpsDots;
  var compStatus = compassReady ? "Comp:OK" : "Comp" + magDots;
  g.drawString(gpsStatus + " | " + compStatus, 88, 8);
}

function drawSaveScreen() {
  g.clear();
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  if (lastFix && lastFix.fix) {
    var acc = lastFix.hdop ? Math.round(lastFix.hdop * 5) : "?";
    var sats = lastFix.satellites || 0;
    var good = fixHistory.length >= 3;
    var waitDots = ["", ".", ".."][gpsMeasCount % 3];
    g.drawString(good ? "GPS READY" : "GPS WAIT" + waitDots, 88, 20);
    g.setFont("6x8", 1);
    g.drawString("Sats: " + sats + " | ~" + acc + "m acc", 88, 45);
    g.drawString("Samples: " + fixHistory.length + "/" + MAX_HISTORY, 88, 55);
    g.drawString("Lat: " + lastFix.lat.toFixed(6), 88, 70);
    g.drawString("Lon: " + lastFix.lon.toFixed(6), 88, 85);
    g.setFont("6x8", 2);
    if (good) {
      g.drawString("TAP TO SAVE", 88, 125);
      g.drawString("& RETURN", 88, 150);
    } else {
      g.drawString("TAP = save now", 88, 125);
      g.drawString("(will estimate)", 88, 150);
    }
  } else {
    var noGpsDots = [".", "..", "..."][gpsMeasCount % 3];
    g.drawString("No GPS yet" + noGpsDots, 88, 50);
    g.setFont("6x8", 1);
    g.drawString("TAP = save anyway", 88, 90);
    g.drawString("(will estimate once", 88, 105);
    g.drawString("signal is found)", 88, 120);
    g.drawString("BTN = back to clock", 88, 150);
  }
}

function drawNavScreen() {
  g.clear();
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);

  if (estimating) {
    var estDots = [".", "..", "..."][gpsMeasCount % 3];
    if (trackLog.length < 3) {
      g.drawString("Estimating" + estDots, 88, 60);
      g.setFont("6x8", 1);
      g.drawString("Walk straight, GPS", 88, 90);
      g.drawString("will estimate start", 88, 105);
      g.drawString("Fixes: " + trackLog.length, 88, 130);
      return;
    }
    var origin = estimateOrigin();
    if (origin) {
      savedData = { lat: origin.lat, lon: origin.lon, time: saveTime };
      storage.writeJSON("goback.json", savedData);
      updateSavedTimeStr();
      estimating = false;
      Bangle.buzz(300);
    } else {
      g.drawString("Estimating" + estDots, 88, 60);
      g.setFont("6x8", 1);
      g.drawString("Keep walking straight", 88, 90);
      g.drawString("Fixes: " + trackLog.length, 88, 130);
      return;
    }
  }

  if (!lastFix || !lastFix.fix || !savedData) {
    var sats = (lastFix && lastFix.satellites) ? lastFix.satellites : 0;
    // Each dot = one GPS measurement received from hardware
    var frame = gpsMeasCount % 4;
    var dots = [".", "..", "...", "...."][frame];
    g.drawString("Acquiring GPS", 88, 55);
    g.drawString(dots, 88, 80);
    g.setFont("6x8", 1);
    g.drawString("Satellites: " + sats, 88, 110);
    g.drawString("Readings: " + gpsMeasCount, 88, 125);
    return;
  }

  // Use HDOP-weighted averaged position for bearing
  var avgLat = lastFix.lat, avgLon = lastFix.lon;
  if (posHistory.length >= 2) {
    var totalWeight = 0;
    avgLat = 0; avgLon = 0;
    for (var i = 0; i < posHistory.length; i++) {
      var w = posHistory[i].weight;
      avgLat += posHistory[i].lat * w;
      avgLon += posHistory[i].lon * w;
      totalWeight += w;
    }
    avgLat /= totalWeight;
    avgLon /= totalWeight;
  }

  var dist = getDistance(avgLat, avgLon, savedData.lat, savedData.lon);
  var bearing = getBearing(avgLat, avgLon, savedData.lat, savedData.lon);
  var relAngle = (bearing - heading + 360) % 360;

  if (dist < 5 && !arrivedDismissed) {
    if (!arrived) {
      arrived = true;
      Bangle.setLCDPower(1);
      Bangle.buzz(500);
    }
    g.drawString("ARRIVED!", 88, 80);
    g.setFont("6x8", 1);
    g.drawString("TAP=continue | BTN=clock", 88, 100);
    return;
  }
  if (arrived && !arrivedDismissed && dist < 15) {
    // Stay in arrived state until clearly moved away (hysteresis)
    g.drawString("ARRIVED!", 88, 80);
    g.setFont("6x8", 1);
    g.drawString("TAP=continue | BTN=clock", 88, 100);
    return;
  }
  if (dist > 15) arrivedDismissed = false;
  arrived = false;

  // Battery (top-left) - EMA smoothed, update every 30s
  var bnow = Date.now();
  if (bnow - battLastUpdate > 30000) {
    var rawBatt = E.getBattery();
    battSmooth = battSmooth * 0.7 + rawBatt * 0.3;
    battLastUpdate = bnow;
  }
  g.setFont("6x8", 1);
  g.setFontAlign(-1, 0);
  var battPct = Math.round(battSmooth);
  var battStr = "Batt:" + battPct + "%";
  var battElapsed = (bnow - battStartTime) / 3600000;
  var battDrain = battStartLevel - battSmooth;
  if (battDrain > 1 && battElapsed > 0.05) {
    var ratePerHour = battDrain / battElapsed;
    var hoursLeft = battSmooth / ratePerHour;
    if (hoursLeft < 1) battStr += " ~" + Math.round(hoursLeft * 60) + "m";
    else battStr += " ~" + hoursLeft.toFixed(0) + "h";
  }
  if (battPct < 20) {
    g.setColor(1, 0, 0);
    if (!lowBattWarned) { lowBattWarned = true; Bangle.buzz(50); }
  }
  g.drawString(battStr, 2, 8);
  g.setColor(1, 1, 1);

  // Time (top-right)
  var tNow = new Date();
  var timeStr = tNow.getHours() + ":" + (tNow.getMinutes() < 10 ? "0" : "") + tNow.getMinutes();
  g.setFontAlign(1, 0);
  g.drawString(timeStr, 174, 8);

  // Screen-on indicator (center-top)
  if (keepScreenOn) {
    g.setFontAlign(0, 0);
    g.drawString("ON", 88, 8);
  }
  g.setFontAlign(0, 0);

  // Distance
  g.setFont("6x8", 2);
  g.setFontAlign(0, 0);
  g.drawString(formatDist(dist), 88, 20);

  // Trend
  var trend = "";
  if (lastDist !== null) {
    var delta = dist - lastDist;
    if (delta < -1) {
      trend = " +";
      // Getting closer - reset wrong-way tracking
      wrongWayCount = 0;
      wrongWayDist = 0;
      wrongWayWarned = false;
    } else if (delta > 1) {
      trend = " -";
      // Getting further - track consecutive increases
      if (speed > 1) {
        wrongWayCount++;
        wrongWayDist += delta;
        if (wrongWayCount >= 5 && wrongWayDist > 15 && !wrongWayWarned) {
          Bangle.buzz(100);
          wrongWayTimer = setTimeout(function() { Bangle.buzz(100); wrongWayTimer = null; }, 200);
          wrongWayWarned = true;
        }
      }
    } else {
      // Marginal change, don't reset but don't count
    }
  }
  lastDist = dist;

  g.setFont("6x8", 1);
  g.drawString(cardinalDir(bearing), 88, 34);
  if (trend === " +") {
    g.setColor(0, 1, 0);
    g.fillRect(2, 30, 5, 38);
    g.setFontAlign(0, 0);
    g.drawString("+", 88 + g.stringWidth(cardinalDir(bearing)) / 2 + 6, 34);
    g.setColor(1, 1, 1);
  } else if (trend === " -") {
    g.setColor(1, 0, 0);
    g.fillRect(2, 30, 5, 38);
    g.setFontAlign(0, 0);
    g.drawString("-", 88 + g.stringWidth(cardinalDir(bearing)) / 2 + 6, 34);
    g.setColor(1, 1, 1);
  }

  // ETA using rolling average speed
  var etaStr = "--";
  var avgSpeed = 0;
  if (speedHistory.length > 0) {
    var sum = 0;
    for (var si = 0; si < speedHistory.length; si++) sum += speedHistory[si].speed;
    avgSpeed = sum / speedHistory.length;
  }
  if (avgSpeed > 0.3) {
    var secs = Math.round(dist / avgSpeed);
    var mins = Math.floor(secs / 60);
    var s = secs % 60;
    etaStr = mins + ":" + (s < 10 ? "0" : "") + s;
  }
  var spdKmh = (speed * 3.6).toFixed(1);
  g.drawString("ETA:" + etaStr + " | " + spdKmh + "km/h", 88, 44);

  // Off-course detection
  var offAngle = Math.abs(angleDiff(relAngle, 0));
  if (offAngle > 90 && speed > 1 && dist > CLOSE_RANGE) {
    offCourseCount++;
    if (offCourseCount >= 8 && !offCourseWarned) {
      offCourseWarned = true;
      Bangle.setLCDPower(1);
      Bangle.buzz(50);
      setTimeout(function() { Bangle.buzz(50); }, 150);
      setTimeout(function() { Bangle.buzz(50); }, 300);
    }
  } else {
    offCourseCount = 0;
    offCourseWarned = false;
  }

  // Arrow
  if (dist < CLOSE_RANGE) {
    g.setFont("6x8", 1);
    g.drawString("Within ~" + Math.round(dist) + "m", 88, 55);
    g.drawString("(bearing unreliable)", 88, 65);
    var radius = Math.max(8, 35 * (dist / CLOSE_RANGE));
    g.drawCircle(88, 100, radius);
    drawArrow(88, 100, relAngle, 30);
  } else if (useGps) {
    g.setFont("6x8", 1);
    g.drawString("GPS heading (moving)", 88, 55);
    drawArrow(88, 100, relAngle, 42);
  } else if (!compassReady) {
    g.setFont("6x8", 1);
    g.drawString("Calibrating compass...", 88, 55);
    g.drawString("Rotate wrist in figure-8", 88, 65);
    g.setColor(0.6, 0.6, 0.6);
    drawArrow(88, 100, relAngle, 42);
    g.setColor(1, 1, 1);
  } else {
    drawArrow(88, 100, relAngle, 42);
  }

  // Side bars: no bar = unreliable, double-wide green = reliable
  var barTop = 58, barBot = 140;
  if (lastFix && lastFix.fix) {
    g.setColor(0, 1, 0);
    g.fillRect(0, barTop, 7, barBot);
  }
  if (headingLocked || useGps) {
    g.setColor(0, 1, 0);
    g.fillRect(168, barTop, 175, barBot);
  }
  g.setColor(1, 1, 1);

  // Bottom info
  g.setFont("6x8", 1);
  g.setFontAlign(0, 0);
  var accM = lastFix.hdop ? Math.round(lastFix.hdop * 5) : "?";
  var confStr = "~" + accM + "m";
  var elapsed = "";
  if (savedData && savedData.time) {
    var elapsedMin = Math.floor((Date.now() - savedData.time) / 60000);
    if (elapsedMin < 60) elapsed = elapsedMin + "min";
    else elapsed = Math.floor(elapsedMin / 60) + "h" + (elapsedMin % 60) + "m";
  }
  g.drawString(elapsed + " | " + cardinalDir(bearing) + " | " + confStr, 88, 135);
  if (navExitConfirm) {
    g.drawString("TAP AGAIN to exit!", 88, 150);
  } else {
    g.drawString("BTN=clock | TAP=menu", 88, 150);
  }
  if (sentToPhone) {
    g.drawString("Sent to phone", 88, 162);
  } else {
    g.drawString("Swipe up=phone | down=screen", 88, 162);
  }
}

function draw() {
  if (mode === "menu") {
    drawMenuScreen();
  } else if (mode === "save") {
    drawSaveScreen();
  } else {
    drawNavScreen();
  }
}

// GPS and compass start immediately on app launch
Bangle.setGPSPower(1, "goback");
Bangle.setCompassPower(1, "goback");

Bangle.on('GPS', function(fix) {
  gpsMeasCount++;
  if (fix.fix || !lastFix || !lastFix.fix) lastFix = fix;
  if (fix.fix && fix.speed !== undefined && !isNaN(fix.speed)) {
    speed = fix.speed / 3.6;
    var now = Date.now();
    speedHistory.push({ speed: speed, time: now });
    while (speedHistory.length > 0 && (now - speedHistory[0].time) > 30000) speedHistory.shift();
    if (mode !== "menu") {
      if (fix.hdop && fix.hdop < 5) {
        var dominated = false;
        if (posHistory.length > 0) {
          var prev = posHistory[posHistory.length - 1];
          var dt = (Date.now() - lastPosTime) / 1000;
          if (dt < 0.5) dt = 0.5;
          var maxDist = Math.max(speed, 2) * dt * 2.5;
          var jumpDist = getDistance(prev.lat, prev.lon, fix.lat, fix.lon);
          if (jumpDist > maxDist && jumpDist > 10) dominated = true;
        }
        if (!dominated) {
          var weight = 1 / fix.hdop;
          posHistory.push({ lat: fix.lat, lon: fix.lon, weight: weight });
          if (posHistory.length > MAX_POS_HISTORY) posHistory.shift();
          lastPosTime = Date.now();
        }
      }
      if (speed > 1 && fix.course !== undefined && !isNaN(fix.course)) {
        smoothGpsCourse = smoothAngle(smoothGpsCourse, fix.course, 0.5);
        useGps = true;
        lastGpsTime = Date.now();
        if (smoothHeading !== null && speed > 1.5) {
          var decl = angleDiff(smoothGpsCourse, smoothHeading);
          declinationSamples.push(decl);
          declinationSum += decl;
          if (declinationSamples.length > 20) {
            declinationSum -= declinationSamples.shift();
          }
          if (declinationSamples.length >= 5) {
            magDeclination = declinationSum / declinationSamples.length;
          }
        }
        var gpsWeight = Math.min((speed - 1) / 1.5, 1);
        var compassHeading = smoothHeading !== null ? (smoothHeading + magDeclination + 360) % 360 : smoothGpsCourse;
        var diff = angleDiff(smoothGpsCourse, compassHeading);
        blendedHeading = (compassHeading + diff * gpsWeight + 360) % 360;
        heading = blendedHeading;
      } else {
        useGps = false;
        if (smoothHeading !== null) {
          var compassH = (smoothHeading + magDeclination + 360) % 360;
          if (blendedHeading !== null) {
            blendedHeading = smoothAngle(blendedHeading, compassH, 0.6);
            heading = blendedHeading;
          } else {
            heading = compassH;
            blendedHeading = compassH;
          }
        }
      }
    } else {
      if (speed > 1 && fix.course !== undefined && !isNaN(fix.course)) {
        smoothGpsCourse = smoothAngle(smoothGpsCourse, fix.course, 0.5);
        useGps = true;
      } else {
        useGps = false;
      }
    }
  } else if (!fix.fix) {
    if (!lastFix || !lastFix.fix) {
      speed = 0;
      useGps = false;
    }
  }
  if (fix.fix && fix.lat !== undefined && fix.lon !== undefined) {
    fixHistory.push({ lat: fix.lat, lon: fix.lon });
    if (fixHistory.length > MAX_HISTORY) fixHistory.shift();
  }
  if (mode === "navigate" && estimating && fix.fix && fix.hdop && fix.hdop < 4) {
    trackLog.push({ lat: fix.lat, lon: fix.lon, time: Date.now() });
    if (trackLog.length > MAX_TRACK_LOG) trackLog.shift();
  }
});

Bangle.on('mag', function(m) {
  magMeasCount++;
  if (m.heading !== undefined && !isNaN(m.heading)) {
    if (smoothHeading === null) {
      smoothHeading = m.heading;
    } else {
      // Reject outlier readings >90° from current smoothed heading
      var jump = Math.abs(angleDiff(m.heading, smoothHeading));
      if (jump < 90) {
        smoothHeading = smoothAngle(smoothHeading, m.heading, HEADING_SMOOTH);
      }
    }
    // Always update heading from compass if GPS is stale or not in use
    var gpsStale = (Date.now() - lastGpsTime) > GPS_STALE_MS;
    if (!useGps || gpsStale) {
      if (gpsStale) useGps = false;
      var compassH = (smoothHeading + magDeclination + 360) % 360;
      if (blendedHeading !== null) {
        blendedHeading = smoothAngle(blendedHeading, compassH, 0.6);
        heading = blendedHeading;
      } else {
        heading = compassH;
        blendedHeading = compassH;
      }
    }
    // Heading lock detection when stationary
    if (speed < 0.5 && compassReady) {
      stationaryHeadings.push(smoothHeading);
      if (stationaryHeadings.length > 12) stationaryHeadings.shift();
      if (stationaryHeadings.length >= 8) {
        var hMin = stationaryHeadings[0], hMax = stationaryHeadings[0];
        for (var hi = 1; hi < stationaryHeadings.length; hi++) {
          if (stationaryHeadings[hi] < hMin) hMin = stationaryHeadings[hi];
          if (stationaryHeadings[hi] > hMax) hMax = stationaryHeadings[hi];
        }
        var hRange = hMax - hMin;
        if (hRange > 180) hRange = 360 - hRange;
        headingLocked = hRange < 8;
      }
    } else {
      stationaryHeadings = [];
      headingLocked = false;
    }
    if (!compassReady) {
      magSamples.push(m.heading);
      if (magSamples.length > 20) magSamples.shift();
      smoothHistory.push(smoothHeading);
      if (smoothHistory.length > 10) smoothHistory.shift();
      if (magSamples.length >= MIN_SAMPLES) {
        var min = magSamples[0], max = magSamples[0];
        for (var i = 1; i < magSamples.length; i++) {
          if (magSamples[i] < min) min = magSamples[i];
          if (magSamples[i] > max) max = magSamples[i];
        }
        var rawRange = max - min;
        if (rawRange > 180) rawRange = 360 - rawRange;
        var smoothStable = false;
        if (smoothHistory.length >= 10) {
          var sMin = smoothHistory[0], sMax = smoothHistory[0];
          for (var i = 1; i < smoothHistory.length; i++) {
            if (smoothHistory[i] < sMin) sMin = smoothHistory[i];
            if (smoothHistory[i] > sMax) sMax = smoothHistory[i];
          }
          var sRange = sMax - sMin;
          if (sRange > 180) sRange = 360 - sRange;
          smoothStable = sRange < 15;
        }
        compassReady = rawRange < 30 && smoothStable;
        if (compassReady) {
          magSamples = [];
          smoothHistory = [];
        }
      }
    }
  }
});

// Touch handler
Bangle.on('touch', function(btn, xy) {
  if (mode === "menu") {
    if (xy && xy.x < 88) {
      mode = "save";
      clearConfirm = false;
      if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
      draw();
    } else if (xy && xy.x >= 88 && savedData) {
      mode = "navigate";
      lastDist = null;
      arrived = false;
      arrivedDismissed = false;
      wrongWayCount = 0;
      wrongWayDist = 0;
      wrongWayWarned = false;
      offCourseCount = 0;
      offCourseWarned = false;
      clearConfirm = false;
      if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
      startDrawLoop();
      draw();
    }
  } else if (mode === "save") {
    var good = fixHistory.length >= 3;
    if (good) {
      var avgLat = 0, avgLon = 0;
      for (var i = 0; i < fixHistory.length; i++) {
        avgLat += fixHistory[i].lat;
        avgLon += fixHistory[i].lon;
      }
      avgLat /= fixHistory.length;
      avgLon /= fixHistory.length;
      savedData = { lat: avgLat, lon: avgLon, time: Date.now() };
      storage.writeJSON("goback.json", savedData);
      updateSavedTimeStr();
      Bangle.buzz(200);
      exitApp();
    } else {
      saveTime = Date.now();
      estimating = true;
      trackLog = [];
      mode = "navigate";
      Bangle.buzz(100);
      startDrawLoop();
      draw();
    }
  } else if (mode === "navigate") {
    if (arrived) {
      // Dismiss arrived state, keep navigating
      arrived = false;
      arrivedDismissed = true;
      lastDist = null;
      draw();
    } else if (navExitConfirm) {
      // Second tap - actually exit
      if (navExitTimer) { clearTimeout(navExitTimer); navExitTimer = null; }
      navExitConfirm = false;
      mode = "menu";
      keepScreenOn = false;
      Bangle.setLCDTimeout(origLCDTimeout);
      arrivedDismissed = false;
      estimating = false;
      posHistory = [];
      lastDist = null;
      wrongWayCount = 0;
      wrongWayDist = 0;
      wrongWayWarned = false;
      offCourseCount = 0;
      offCourseWarned = false;
      startDrawLoop();
      draw();
    } else {
      // First tap - ask for confirmation
      navExitConfirm = true;
      Bangle.buzz(50);
      if (navExitTimer) clearTimeout(navExitTimer);
      navExitTimer = setTimeout(function() {
        navExitConfirm = false;
        navExitTimer = null;
        draw();
      }, 2000);
      draw();
    }
  }
});

function exitApp() {
  if (exiting) return;
  exiting = true;
  if (drawInterval) { clearInterval(drawInterval); drawInterval = null; }
  if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
  if (wrongWayTimer) { clearTimeout(wrongWayTimer); wrongWayTimer = null; }
  if (navExitTimer) { clearTimeout(navExitTimer); navExitTimer = null; }
  if (sentToPhoneTimer) { clearTimeout(sentToPhoneTimer); sentToPhoneTimer = null; }
  Bangle.setLCDTimeout(origLCDTimeout);
  Bangle.setGPSPower(0, "goback");
  Bangle.setCompassPower(0, "goback");
  load();
}

setWatch(exitApp, BTN, { repeat: true, edge: "falling" });

Bangle.on('swipe', function(dirX, dirY) {
  if (mode === "navigate" && dirY === -1 && savedData) {
    openOnPhone();
    return;
  }
  if (mode === "navigate" && dirY === 1) {
    keepScreenOn = !keepScreenOn;
    Bangle.setLCDTimeout(keepScreenOn ? 0 : origLCDTimeout);
    Bangle.buzz(50);
    draw();
    return;
  }
  if (mode === "menu" && dirY === 1 && savedData) {
    if (clearConfirm) {
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = null;
      clearConfirm = false;
      storage.erase("goback.json");
      savedData = null;
      savedTimeStr = "";
      Bangle.buzz(200);
      draw();
    } else {
      clearConfirm = true;
      Bangle.buzz(50);
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(function() {
        clearConfirm = false;
        draw();
      }, 3000);
      draw();
    }
  }
});

// Redraw: fast in navigate mode for responsive compass, slower otherwise
var drawInterval = null;
function startDrawLoop() {
  if (drawInterval) clearInterval(drawInterval);
  drawInterval = setInterval(draw, mode === "navigate" ? 250 : 1000);
}
startDrawLoop();
draw();
