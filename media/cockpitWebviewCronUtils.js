function clampFriendlyNumber(value, min, max, fallback) {
  var parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) {
    parsed = fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function padFriendlyNumber(value) {
  var normalized = clampFriendlyNumber(value, 0, 59, 0);
  return normalized < 10 ? "0" + normalized : String(normalized);
}

function normalizeDayOfWeekValue(value) {
  var normalizedSource = String(value || "");
  var normalized = normalizedSource.trim().toLowerCase();

  if (/^\d+$/.test(normalized)) {
    var numericValue = parseInt(normalized, 10);
    if (numericValue === 7) {
      numericValue = 0;
    }
    if (numericValue >= 0 && numericValue <= 6) {
      return numericValue;
    }
  }

  var aliases = new Map([
    ["sun", 0],
    ["mon", 1],
    ["tue", 2],
    ["wed", 3],
    ["thu", 4],
    ["fri", 5],
    ["sat", 6],
  ]);

  return aliases.has(normalized) ? aliases.get(normalized) : null;
}

function formatFriendlyTime(hour, minute) {
  return padFriendlyNumber(hour) + ":" + padFriendlyNumber(minute);
}

function isFriendlyCronWholeNumber(value) {
  return /^\d+$/.test(String(value));
}

function parseFriendlyCronNumber(value, min, max) {
  if (!isFriendlyCronWholeNumber(value)) {
    return null;
  }

  var parsed = parseInt(String(value), 10);
  if (parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function getFriendlyFieldsForSelection(selection) {
  switch (selection) {
    case "every-n":
      return ["interval"];
    case "hourly":
      return ["minute"];
    case "daily":
      return ["hour", "minute"];
    case "weekly":
      return ["dow", "hour", "minute"];
    case "monthly":
      return ["dom", "hour", "minute"];
    default:
      return [];
  }
}

export function syncFriendlyFieldVisibility(builder, selection) {
  var visibleFields = getFriendlyFieldsForSelection(selection);
  var friendlyFields = builder
    ? builder.querySelectorAll(".friendly-field")
    : [];

  for (var index = 0; index < friendlyFields.length; index += 1) {
    var element = friendlyFields[index];
    if (!element || !element.getAttribute) {
      continue;
    }

    var fieldName = element.getAttribute("data-field");
    var isVisible = visibleFields.indexOf(fieldName) !== -1;

    if (element.classList) {
      if (isVisible) {
        element.classList.add("visible");
      } else {
        element.classList.remove("visible");
      }
    }

    if (element.style) {
      element.style.display = isVisible ? "block" : "none";
    }
  }
}

export function buildFriendlyCronExpression(selection, rawValues) {
  var values = rawValues || {};

  switch (selection) {
    case "every-n":
      return (
        "*/" +
        clampFriendlyNumber(values.interval, 1, 59, 5) +
        " * * * *"
      );
    case "hourly":
      return clampFriendlyNumber(values.minute, 0, 59, 0) + " * * * *";
    case "daily":
      return (
        clampFriendlyNumber(values.minute, 0, 59, 0) +
        " " +
        clampFriendlyNumber(values.hour, 0, 23, 9) +
        " * * *"
      );
    case "weekly":
      return (
        clampFriendlyNumber(values.minute, 0, 59, 0) +
        " " +
        clampFriendlyNumber(values.hour, 0, 23, 9) +
        " * * " +
        clampFriendlyNumber(values.dow, 0, 6, 1)
      );
    case "monthly":
      return (
        clampFriendlyNumber(values.minute, 0, 59, 0) +
        " " +
        clampFriendlyNumber(values.hour, 0, 23, 9) +
        " " +
        clampFriendlyNumber(values.dom, 1, 31, 1) +
        " * *"
      );
    default:
      return "";
  }
}

export function parseFriendlyCronExpression(expression) {
  var normalizedExpression = String(expression || "").trim();
  if (!normalizedExpression) {
    return null;
  }

  var cronParts = normalizedExpression.split(/\s+/);
  if (cronParts.length !== 5) {
    return null;
  }

  var minute = cronParts[0];
  var hour = cronParts[1];
  var dayOfMonth = cronParts[2];
  var month = cronParts[3];
  var dayOfWeek = cronParts[4];
  var intervalMatch = /^\*\/(\d+)$/.exec(minute);
  var parsedMinute = parseFriendlyCronNumber(minute, 0, 59);
  var parsedHour = parseFriendlyCronNumber(hour, 0, 23);
  var parsedDayOfMonth = parseFriendlyCronNumber(dayOfMonth, 1, 31);
  var parsedDayOfWeek = normalizeDayOfWeekValue(dayOfWeek);

  if (
    intervalMatch &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    var parsedInterval = parseFriendlyCronNumber(intervalMatch[1], 1, 59);
    return parsedInterval === null
      ? null
      : {
        frequency: "every-n",
        interval: parsedInterval,
      };
  }

  if (
    parsedMinute !== null &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      frequency: "hourly",
      minute: parsedMinute,
    };
  }

  if (
    parsedMinute !== null &&
    parsedHour !== null &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      frequency: "daily",
      hour: parsedHour,
      minute: parsedMinute,
    };
  }

  if (
    parsedMinute !== null &&
    parsedHour !== null &&
    dayOfMonth === "*" &&
    month === "*" &&
    parsedDayOfWeek !== null
  ) {
    return {
      frequency: "weekly",
      dow: parsedDayOfWeek,
      hour: parsedHour,
      minute: parsedMinute,
    };
  }

  if (
    parsedMinute !== null &&
    parsedHour !== null &&
    parsedDayOfMonth !== null &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      frequency: "monthly",
      dom: parsedDayOfMonth,
      hour: parsedHour,
      minute: parsedMinute,
    };
  }

  return null;
}

export function summarizeCronExpression(expression, strings) {
  var labels = strings || {};
  var fallback = labels.labelFriendlyFallback || "";
  var normalizedExpression = String(expression || "").trim();
  if (!normalizedExpression) {
    return fallback;
  }

  var cronParts = normalizedExpression.split(/\s+/);
  if (cronParts.length !== 5) {
    return fallback;
  }

  var minute = cronParts[0];
  var hour = cronParts[1];
  var dayOfMonth = cronParts[2];
  var month = cronParts[3];
  var dayOfWeek = cronParts[4];
  var normalizedDayOfWeek = String(dayOfWeek || "").toLowerCase();
  var isWeekdays =
    normalizedDayOfWeek === "1-5" || normalizedDayOfWeek === "mon-fri";
  var everyNMinutesMatch = /^\*\/(\d+)$/.exec(minute);

  if (
    everyNMinutesMatch &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    var everyNTemplate = labels.cronPreviewEveryNMinutes || "";
    return everyNTemplate
      ? everyNTemplate.replace("{n}", String(everyNMinutesMatch[1]))
      : fallback;
  }

  if (
    isFriendlyCronWholeNumber(minute) &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    var hourlyTemplate = labels.cronPreviewHourlyAtMinute || "";
    return hourlyTemplate
      ? hourlyTemplate.replace("{m}", String(minute))
      : fallback;
  }

  if (
    isFriendlyCronWholeNumber(minute) &&
    isFriendlyCronWholeNumber(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    var dailyTemplate = labels.cronPreviewDailyAt || "";
    var dailyTime = formatFriendlyTime(hour, minute);
    return dailyTemplate
      ? dailyTemplate.replace("{t}", String(dailyTime))
      : fallback;
  }

  if (
    isFriendlyCronWholeNumber(minute) &&
    isFriendlyCronWholeNumber(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    isWeekdays
  ) {
    var weekdaysTemplate = labels.cronPreviewWeekdaysAt || "";
    var weekdaysTime = formatFriendlyTime(hour, minute);
    return weekdaysTemplate
      ? weekdaysTemplate.replace("{t}", String(weekdaysTime))
      : fallback;
  }

  var numericDayOfWeek = normalizeDayOfWeekValue(dayOfWeek);
  if (
    isFriendlyCronWholeNumber(minute) &&
    isFriendlyCronWholeNumber(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    numericDayOfWeek !== null
  ) {
    var weeklyTemplate = labels.cronPreviewWeeklyOnAt || "";
    var dayNames = [
      labels.daySun || "",
      labels.dayMon || "",
      labels.dayTue || "",
      labels.dayWed || "",
      labels.dayThu || "",
      labels.dayFri || "",
      labels.daySat || "",
    ];
    var weeklyTime = formatFriendlyTime(hour, minute);
    var weeklyDayLabel = dayNames[numericDayOfWeek] || String(numericDayOfWeek);
    return weeklyTemplate
      ? weeklyTemplate
          .replace("{d}", String(weeklyDayLabel))
          .replace("{t}", String(weeklyTime))
      : fallback;
  }

  if (
    isFriendlyCronWholeNumber(minute) &&
    isFriendlyCronWholeNumber(hour) &&
    isFriendlyCronWholeNumber(dayOfMonth) &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    var monthlyTemplate = labels.cronPreviewMonthlyOnAt || "";
    var monthlyTime = formatFriendlyTime(hour, minute);
    return monthlyTemplate
      ? monthlyTemplate
          .replace("{dom}", String(dayOfMonth))
          .replace("{t}", String(monthlyTime))
      : fallback;
  }

  return fallback;
}
