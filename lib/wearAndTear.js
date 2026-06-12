/**
 * Standard useful-life estimates for rental property items (years).
 * Used to calculate expected wear during a tenancy.
 * Sources: common property-management depreciation schedules; adjust for your market.
 */
export const ITEM_LIFESPAN_YEARS = {
  interior_paint: 3,
  carpet: 5,
  vinyl_flooring: 10,
  laminate_flooring: 15,
  hardwood_flooring: 25,
  tile_flooring: 30,
  countertop_laminate: 15,
  countertop_solid: 25,
  cabinet_finish: 20,
  interior_door: 30,
  window_blinds: 5,
  window_screens: 5,
  refrigerator: 12,
  range_oven: 15,
  dishwasher: 10,
  washer_dryer: 10,
  bathroom_fixture: 20,
  toilet: 25,
  tub_shower: 25,
  drywall: 30,
  baseboard_trim: 25,
  light_fixture: 15,
  general_wall: 3,
  general_floor: 10,
  general: 10,
};

export const ITEM_LABELS = {
  interior_paint: "Interior paint",
  carpet: "Carpet",
  vinyl_flooring: "Vinyl flooring",
  laminate_flooring: "Laminate flooring",
  hardwood_flooring: "Hardwood flooring",
  tile_flooring: "Tile flooring",
  countertop_laminate: "Laminate countertop",
  countertop_solid: "Solid-surface countertop",
  cabinet_finish: "Cabinet finish",
  interior_door: "Interior door",
  window_blinds: "Window blinds",
  window_screens: "Window screens",
  refrigerator: "Refrigerator",
  range_oven: "Range / oven",
  dishwasher: "Dishwasher",
  washer_dryer: "Washer / dryer",
  bathroom_fixture: "Bathroom fixture",
  toilet: "Toilet",
  tub_shower: "Tub / shower",
  drywall: "Drywall",
  baseboard_trim: "Baseboard / trim",
  light_fixture: "Light fixture",
  general_wall: "Wall surface (general)",
  general_floor: "Floor surface (general)",
  general: "General item",
};

export const AREA_OPTIONS = [
  "Kitchen",
  "Bathroom",
  "Living room",
  "Bedroom 1",
  "Bedroom 2",
  "Bedroom 3",
  "Hallway",
  "Dining room",
  "Laundry",
  "Garage",
  "Exterior",
  "Other (custom)",
];

/**
 * @param {Date} moveIn
 * @param {Date} moveOut
 */
export function getTenancyDuration(moveIn, moveOut) {
  const ms = moveOut.getTime() - moveIn.getTime();
  if (ms < 0) {
    return null;
  }
  const days = ms / (1000 * 60 * 60 * 24);
  const years = days / 365.25;
  const months = days / 30.4375;
  return { days: Math.round(days), years, months };
}

export function formatTenancySummary(duration) {
  if (!duration) {
    return "Move-out date must be on or after move-in date.";
  }
  const monthPart =
    duration.months >= 1
      ? `${Math.round(duration.months)} month${Math.round(duration.months) === 1 ? "" : "s"}`
      : `${duration.days} day${duration.days === 1 ? "" : "s"}`;
  const yearPart = `${duration.years.toFixed(2)} years`;
  return `Tenancy length: ${monthPart} (${yearPart})`;
}

/**
 * Expected wear as a percentage of total item life consumed during tenancy.
 */
export function getExpectedWearPercent(tenancyYears, itemKey) {
  const lifespan = ITEM_LIFESPAN_YEARS[itemKey] || ITEM_LIFESPAN_YEARS.general;
  return Math.min((tenancyYears / lifespan) * 100, 100);
}

/**
 * Classify whether observed damage severity exceeds normal wear for the tenancy.
 * @param {number} severityScore 0-100
 * @param {string} itemKey
 * @param {number} tenancyYears
 * @param {number} [bufferPercent=12] grace above expected wear
 */
export function classifyDamage(severityScore, itemKey, tenancyYears, bufferPercent = 12) {
  const expectedWear = getExpectedWearPercent(tenancyYears, itemKey);
  const threshold = Math.min(expectedWear + bufferPercent, 100);
  const lifespan = ITEM_LIFESPAN_YEARS[itemKey] || ITEM_LIFESPAN_YEARS.general;
  const label = ITEM_LABELS[itemKey] || ITEM_LABELS.general;

  if (severityScore <= threshold) {
    return {
      classification: "wear_and_tear",
      chargeable: false,
      expectedWearPercent: expectedWear,
      threshold,
      excessSeverity: 0,
      itemKey,
      itemLabel: label,
      lifespanYears: lifespan,
      rationale: `Observed severity (${severityScore.toFixed(0)}%) is within expected wear (${expectedWear.toFixed(0)}%) for a ${tenancyYears.toFixed(1)}-year tenancy on ${label} (useful life ~${lifespan} yrs).`,
    };
  }

  return {
    classification: "tenant_damage",
    chargeable: true,
    expectedWearPercent: expectedWear,
    threshold,
    excessSeverity: severityScore - expectedWear,
    itemKey,
    itemLabel: label,
    lifespanYears: lifespan,
    rationale: `Observed severity (${severityScore.toFixed(0)}%) exceeds expected wear (${expectedWear.toFixed(0)}%) for ${label}. Excess ~${(severityScore - expectedWear).toFixed(0)}% may be chargeable.`,
  };
}

/**
 * Map free-text damage descriptions to item keys (heuristic).
 */
export function inferItemKey(description) {
  const text = (description || "").toLowerCase();
  const rules = [
    [/paint|scuff|mark on wall|wall damage|hole|patch|nail hole/, "interior_paint"],
    [/carpet|stain on floor|rug/, "carpet"],
    [/vinyl|linoleum/, "vinyl_flooring"],
    [/laminate floor/, "laminate_flooring"],
    [/hardwood|wood floor/, "hardwood_flooring"],
    [/tile floor|grout/, "tile_flooring"],
    [/counter|countertop/, "countertop_laminate"],
    [/cabinet|drawer front/, "cabinet_finish"],
    [/door|doorknob|hinge/, "interior_door"],
    [/blind|shade/, "window_blinds"],
    [/screen/, "window_screens"],
    [/fridge|refrigerator/, "refrigerator"],
    [/stove|oven|range|burner/, "range_oven"],
    [/dishwasher/, "dishwasher"],
    [/washer|dryer/, "washer_dryer"],
    [/faucet|sink|shower head|fixture/, "bathroom_fixture"],
    [/toilet/, "toilet"],
    [/tub|shower|tile wall/, "tub_shower"],
    [/drywall|large hole/, "drywall"],
    [/baseboard|trim|molding/, "baseboard_trim"],
    [/light|fixture|bulb housing/, "light_fixture"],
    [/floor|flooring/, "general_floor"],
    [/wall/, "general_wall"],
  ];

  for (const [pattern, key] of rules) {
    if (pattern.test(text)) {
      return key;
    }
  }
  return "general";
}
