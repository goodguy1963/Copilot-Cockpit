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
  var normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (/^\d+$/.test(normalized)) {
    var numericValue = parseInt(normalized, 10);
    if (numericValue === 7) {
      numericValue = 0;
    }
    if (numericValue >= 0 && numericValue <= 6) {
      return numericValue;
    }
  }

  var aliases = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return Object.prototype.hasOwnProperty.call(aliases, normalized)
    ? aliases[normalized]
    : null;
}

function formatFriendlyTime(hour, minute) {
  return padFriendlyNumber(hour) + ":" + padFriendlyNumber(minute);
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

export function summarizeCronExpression(expression, strings) {
  var labels = strings || {};
  var fallback = labels.labelFriendlyFallback || "";
  var normalizedExpression = String(expression || "").trim();
  if (!normalizedExpression) {
    return fallback;
  }

  var parts = normalizedExpression.split(/\s+/);
  if (parts.length !== 5) {
    return fallback;
  }

  var minute = parts[0];
  var hour = parts[1];
  var dayOfMonth = parts[2];
  var month = parts[3];
  var dayOfWeek = parts[4];
  var isWholeNumber = function (value) {
    return /^\d+$/.test(String(value));
  };
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
    isWholeNumber(minute) &&
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
    isWholeNumber(minute) &&
    isWholeNumber(hour) &&
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
    isWholeNumber(minute) &&
    isWholeNumber(hour) &&
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
    isWholeNumber(minute) &&
    isWholeNumber(hour) &&
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
    isWholeNumber(minute) &&
    isWholeNumber(hour) &&
    isWholeNumber(dayOfMonth) &&
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
