/**
 * ISO 3166-1 alpha-2 Country & Region data and search helpers for Mizyun mobile.
 *
 * Fully typed, zero-external-dependency, compatible with React Native & Hermes.
 */

export interface CountryItem {
  readonly code: string;
  readonly name: string;
  readonly dialCode?: string;
}

/**
 * Curated list of popular / frequent countries shown first for quick access.
 */
export const POPULAR_COUNTRY_CODES: readonly string[] = [
  "SK",
  "CZ",
  "US",
  "GB",
  "DE",
  "AT",
  "PL",
  "FR",
  "IT",
  "ES",
  "NL",
  "CH",
  "SE",
  "NO",
  "DK",
  "FI",
  "IE",
  "CA",
  "AU",
  "NZ",
  "JP",
] as const;

/**
 * Converts a 2-letter uppercase ISO country code into a Unicode emoji flag.
 * Uses Regional Indicator Symbol pairs (e.g. "SK" -> 🇸🇰).
 */
export function getEmojiFlag(code: string | null | undefined): string {
  if (!code) return "";
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) return "";
  return String.fromCodePoint(
    127397 + trimmed.charCodeAt(0),
    127397 + trimmed.charCodeAt(1),
  );
}

const displayNamesCache = new Map<string, Intl.DisplayNames>();

/**
 * Resolves a localized country name using Hermes/device Intl.DisplayNames,
 * gracefully falling back to the standard English canonical name.
 */
export function getLocalizedCountryName(
  code: string,
  fallbackName?: string,
  locale?: string,
): string {
  try {
    if (
      typeof Intl !== "undefined" &&
      typeof Intl.DisplayNames === "function"
    ) {
      const locKey = locale || "en";
      let displayNames = displayNamesCache.get(locKey);
      if (!displayNames) {
        displayNames = new Intl.DisplayNames([locKey], { type: "region" });
        displayNamesCache.set(locKey, displayNames);
      }
      const resolved = displayNames.of(code.toUpperCase());
      if (
        resolved &&
        resolved !== code.toUpperCase() &&
        resolved !== "Unknown Region"
      ) {
        return resolved;
      }
    }
  } catch {
    // Graceful fallback on unsupported environments or invalid locales
  }
  return fallbackName || code;
}

/**
 * Complete list of 249 ISO 3166-1 alpha-2 countries and territories.
 */
export const COUNTRIES: readonly CountryItem[] = [
  {
    code: "AF",
    name: "Afghanistan",
    dialCode: "+93",
  },
  {
    code: "AX",
    name: "Åland Islands",
    dialCode: "+358",
  },
  {
    code: "AL",
    name: "Albania",
    dialCode: "+355",
  },
  {
    code: "DZ",
    name: "Algeria",
    dialCode: "+213",
  },
  {
    code: "AS",
    name: "American Samoa",
    dialCode: "+1",
  },
  {
    code: "AD",
    name: "Andorra",
    dialCode: "+376",
  },
  {
    code: "AO",
    name: "Angola",
    dialCode: "+244",
  },
  {
    code: "AI",
    name: "Anguilla",
    dialCode: "+1",
  },
  {
    code: "AQ",
    name: "Antarctica",
    dialCode: "+672",
  },
  {
    code: "AG",
    name: "Antigua & Barbuda",
    dialCode: "+1",
  },
  {
    code: "AR",
    name: "Argentina",
    dialCode: "+54",
  },
  {
    code: "AM",
    name: "Armenia",
    dialCode: "+374",
  },
  {
    code: "AW",
    name: "Aruba",
    dialCode: "+297",
  },
  {
    code: "AU",
    name: "Australia",
    dialCode: "+61",
  },
  {
    code: "AT",
    name: "Austria",
    dialCode: "+43",
  },
  {
    code: "AZ",
    name: "Azerbaijan",
    dialCode: "+994",
  },
  {
    code: "BS",
    name: "Bahamas",
    dialCode: "+1",
  },
  {
    code: "BH",
    name: "Bahrain",
    dialCode: "+973",
  },
  {
    code: "BD",
    name: "Bangladesh",
    dialCode: "+880",
  },
  {
    code: "BB",
    name: "Barbados",
    dialCode: "+1",
  },
  {
    code: "BY",
    name: "Belarus",
    dialCode: "+375",
  },
  {
    code: "BE",
    name: "Belgium",
    dialCode: "+32",
  },
  {
    code: "BZ",
    name: "Belize",
    dialCode: "+501",
  },
  {
    code: "BJ",
    name: "Benin",
    dialCode: "+229",
  },
  {
    code: "BM",
    name: "Bermuda",
    dialCode: "+1",
  },
  {
    code: "BT",
    name: "Bhutan",
    dialCode: "+975",
  },
  {
    code: "BO",
    name: "Bolivia",
    dialCode: "+591",
  },
  {
    code: "BA",
    name: "Bosnia & Herzegovina",
    dialCode: "+387",
  },
  {
    code: "BW",
    name: "Botswana",
    dialCode: "+267",
  },
  {
    code: "BV",
    name: "Bouvet Island",
  },
  {
    code: "BR",
    name: "Brazil",
    dialCode: "+55",
  },
  {
    code: "IO",
    name: "British Indian Ocean Territory",
    dialCode: "+246",
  },
  {
    code: "VG",
    name: "British Virgin Islands",
    dialCode: "+1",
  },
  {
    code: "BN",
    name: "Brunei",
    dialCode: "+673",
  },
  {
    code: "BG",
    name: "Bulgaria",
    dialCode: "+359",
  },
  {
    code: "BF",
    name: "Burkina Faso",
    dialCode: "+226",
  },
  {
    code: "BI",
    name: "Burundi",
    dialCode: "+257",
  },
  {
    code: "KH",
    name: "Cambodia",
    dialCode: "+855",
  },
  {
    code: "CM",
    name: "Cameroon",
    dialCode: "+237",
  },
  {
    code: "CA",
    name: "Canada",
    dialCode: "+1",
  },
  {
    code: "CV",
    name: "Cape Verde",
    dialCode: "+238",
  },
  {
    code: "BQ",
    name: "Caribbean Netherlands",
    dialCode: "+599",
  },
  {
    code: "KY",
    name: "Cayman Islands",
    dialCode: "+1",
  },
  {
    code: "CF",
    name: "Central African Republic",
    dialCode: "+236",
  },
  {
    code: "TD",
    name: "Chad",
    dialCode: "+235",
  },
  {
    code: "CL",
    name: "Chile",
    dialCode: "+56",
  },
  {
    code: "CN",
    name: "China",
    dialCode: "+86",
  },
  {
    code: "CX",
    name: "Christmas Island",
    dialCode: "+61",
  },
  {
    code: "CC",
    name: "Cocos (Keeling) Islands",
    dialCode: "+61",
  },
  {
    code: "CO",
    name: "Colombia",
    dialCode: "+57",
  },
  {
    code: "KM",
    name: "Comoros",
    dialCode: "+269",
  },
  {
    code: "CG",
    name: "Congo - Brazzaville",
    dialCode: "+242",
  },
  {
    code: "CD",
    name: "Congo - Kinshasa",
    dialCode: "+243",
  },
  {
    code: "CK",
    name: "Cook Islands",
    dialCode: "+682",
  },
  {
    code: "CR",
    name: "Costa Rica",
    dialCode: "+506",
  },
  {
    code: "CI",
    name: "Côte d’Ivoire",
    dialCode: "+225",
  },
  {
    code: "HR",
    name: "Croatia",
    dialCode: "+385",
  },
  {
    code: "CU",
    name: "Cuba",
    dialCode: "+53",
  },
  {
    code: "CW",
    name: "Curaçao",
    dialCode: "+599",
  },
  {
    code: "CY",
    name: "Cyprus",
    dialCode: "+357",
  },
  {
    code: "CZ",
    name: "Czechia",
    dialCode: "+420",
  },
  {
    code: "DK",
    name: "Denmark",
    dialCode: "+45",
  },
  {
    code: "DJ",
    name: "Djibouti",
    dialCode: "+253",
  },
  {
    code: "DM",
    name: "Dominica",
    dialCode: "+1",
  },
  {
    code: "DO",
    name: "Dominican Republic",
    dialCode: "+1",
  },
  {
    code: "EC",
    name: "Ecuador",
    dialCode: "+593",
  },
  {
    code: "EG",
    name: "Egypt",
    dialCode: "+20",
  },
  {
    code: "SV",
    name: "El Salvador",
    dialCode: "+503",
  },
  {
    code: "GQ",
    name: "Equatorial Guinea",
    dialCode: "+240",
  },
  {
    code: "ER",
    name: "Eritrea",
    dialCode: "+291",
  },
  {
    code: "EE",
    name: "Estonia",
    dialCode: "+372",
  },
  {
    code: "SZ",
    name: "Eswatini",
    dialCode: "+268",
  },
  {
    code: "ET",
    name: "Ethiopia",
    dialCode: "+251",
  },
  {
    code: "FK",
    name: "Falkland Islands",
    dialCode: "+500",
  },
  {
    code: "FO",
    name: "Faroe Islands",
    dialCode: "+298",
  },
  {
    code: "FJ",
    name: "Fiji",
    dialCode: "+679",
  },
  {
    code: "FI",
    name: "Finland",
    dialCode: "+358",
  },
  {
    code: "FR",
    name: "France",
    dialCode: "+33",
  },
  {
    code: "GF",
    name: "French Guiana",
    dialCode: "+594",
  },
  {
    code: "PF",
    name: "French Polynesia",
    dialCode: "+689",
  },
  {
    code: "TF",
    name: "French Southern Territories",
  },
  {
    code: "GA",
    name: "Gabon",
    dialCode: "+241",
  },
  {
    code: "GM",
    name: "Gambia",
    dialCode: "+220",
  },
  {
    code: "GE",
    name: "Georgia",
    dialCode: "+995",
  },
  {
    code: "DE",
    name: "Germany",
    dialCode: "+49",
  },
  {
    code: "GH",
    name: "Ghana",
    dialCode: "+233",
  },
  {
    code: "GI",
    name: "Gibraltar",
    dialCode: "+350",
  },
  {
    code: "GR",
    name: "Greece",
    dialCode: "+30",
  },
  {
    code: "GL",
    name: "Greenland",
    dialCode: "+299",
  },
  {
    code: "GD",
    name: "Grenada",
    dialCode: "+1",
  },
  {
    code: "GP",
    name: "Guadeloupe",
    dialCode: "+590",
  },
  {
    code: "GU",
    name: "Guam",
    dialCode: "+1",
  },
  {
    code: "GT",
    name: "Guatemala",
    dialCode: "+502",
  },
  {
    code: "GG",
    name: "Guernsey",
    dialCode: "+44",
  },
  {
    code: "GN",
    name: "Guinea",
    dialCode: "+224",
  },
  {
    code: "GW",
    name: "Guinea-Bissau",
    dialCode: "+245",
  },
  {
    code: "GY",
    name: "Guyana",
    dialCode: "+592",
  },
  {
    code: "HT",
    name: "Haiti",
    dialCode: "+509",
  },
  {
    code: "HM",
    name: "Heard & McDonald Islands",
  },
  {
    code: "HN",
    name: "Honduras",
    dialCode: "+504",
  },
  {
    code: "HK",
    name: "Hong Kong SAR China",
    dialCode: "+852",
  },
  {
    code: "HU",
    name: "Hungary",
    dialCode: "+36",
  },
  {
    code: "IS",
    name: "Iceland",
    dialCode: "+354",
  },
  {
    code: "IN",
    name: "India",
    dialCode: "+91",
  },
  {
    code: "ID",
    name: "Indonesia",
    dialCode: "+62",
  },
  {
    code: "IR",
    name: "Iran",
    dialCode: "+98",
  },
  {
    code: "IQ",
    name: "Iraq",
    dialCode: "+964",
  },
  {
    code: "IE",
    name: "Ireland",
    dialCode: "+353",
  },
  {
    code: "IM",
    name: "Isle of Man",
    dialCode: "+44",
  },
  {
    code: "IL",
    name: "Israel",
    dialCode: "+972",
  },
  {
    code: "IT",
    name: "Italy",
    dialCode: "+39",
  },
  {
    code: "JM",
    name: "Jamaica",
    dialCode: "+1",
  },
  {
    code: "JP",
    name: "Japan",
    dialCode: "+81",
  },
  {
    code: "JE",
    name: "Jersey",
    dialCode: "+44",
  },
  {
    code: "JO",
    name: "Jordan",
    dialCode: "+962",
  },
  {
    code: "KZ",
    name: "Kazakhstan",
    dialCode: "+7",
  },
  {
    code: "KE",
    name: "Kenya",
    dialCode: "+254",
  },
  {
    code: "KI",
    name: "Kiribati",
    dialCode: "+686",
  },
  {
    code: "KW",
    name: "Kuwait",
    dialCode: "+965",
  },
  {
    code: "KG",
    name: "Kyrgyzstan",
    dialCode: "+996",
  },
  {
    code: "LA",
    name: "Laos",
    dialCode: "+856",
  },
  {
    code: "LV",
    name: "Latvia",
    dialCode: "+371",
  },
  {
    code: "LB",
    name: "Lebanon",
    dialCode: "+961",
  },
  {
    code: "LS",
    name: "Lesotho",
    dialCode: "+266",
  },
  {
    code: "LR",
    name: "Liberia",
    dialCode: "+231",
  },
  {
    code: "LY",
    name: "Libya",
    dialCode: "+218",
  },
  {
    code: "LI",
    name: "Liechtenstein",
    dialCode: "+423",
  },
  {
    code: "LT",
    name: "Lithuania",
    dialCode: "+370",
  },
  {
    code: "LU",
    name: "Luxembourg",
    dialCode: "+352",
  },
  {
    code: "MO",
    name: "Macao SAR China",
    dialCode: "+853",
  },
  {
    code: "MG",
    name: "Madagascar",
    dialCode: "+261",
  },
  {
    code: "MW",
    name: "Malawi",
    dialCode: "+265",
  },
  {
    code: "MY",
    name: "Malaysia",
    dialCode: "+60",
  },
  {
    code: "MV",
    name: "Maldives",
    dialCode: "+960",
  },
  {
    code: "ML",
    name: "Mali",
    dialCode: "+223",
  },
  {
    code: "MT",
    name: "Malta",
    dialCode: "+356",
  },
  {
    code: "MH",
    name: "Marshall Islands",
    dialCode: "+692",
  },
  {
    code: "MQ",
    name: "Martinique",
    dialCode: "+596",
  },
  {
    code: "MR",
    name: "Mauritania",
    dialCode: "+222",
  },
  {
    code: "MU",
    name: "Mauritius",
    dialCode: "+230",
  },
  {
    code: "YT",
    name: "Mayotte",
    dialCode: "+262",
  },
  {
    code: "MX",
    name: "Mexico",
    dialCode: "+52",
  },
  {
    code: "FM",
    name: "Micronesia",
    dialCode: "+691",
  },
  {
    code: "MD",
    name: "Moldova",
    dialCode: "+373",
  },
  {
    code: "MC",
    name: "Monaco",
    dialCode: "+377",
  },
  {
    code: "MN",
    name: "Mongolia",
    dialCode: "+976",
  },
  {
    code: "ME",
    name: "Montenegro",
    dialCode: "+382",
  },
  {
    code: "MS",
    name: "Montserrat",
    dialCode: "+1",
  },
  {
    code: "MA",
    name: "Morocco",
    dialCode: "+212",
  },
  {
    code: "MZ",
    name: "Mozambique",
    dialCode: "+258",
  },
  {
    code: "MM",
    name: "Myanmar (Burma)",
    dialCode: "+95",
  },
  {
    code: "NA",
    name: "Namibia",
    dialCode: "+264",
  },
  {
    code: "NR",
    name: "Nauru",
    dialCode: "+674",
  },
  {
    code: "NP",
    name: "Nepal",
    dialCode: "+977",
  },
  {
    code: "NL",
    name: "Netherlands",
    dialCode: "+31",
  },
  {
    code: "NC",
    name: "New Caledonia",
    dialCode: "+687",
  },
  {
    code: "NZ",
    name: "New Zealand",
    dialCode: "+64",
  },
  {
    code: "NI",
    name: "Nicaragua",
    dialCode: "+505",
  },
  {
    code: "NE",
    name: "Niger",
    dialCode: "+227",
  },
  {
    code: "NG",
    name: "Nigeria",
    dialCode: "+234",
  },
  {
    code: "NU",
    name: "Niue",
    dialCode: "+683",
  },
  {
    code: "NF",
    name: "Norfolk Island",
    dialCode: "+672",
  },
  {
    code: "KP",
    name: "North Korea",
    dialCode: "+850",
  },
  {
    code: "MK",
    name: "North Macedonia",
    dialCode: "+389",
  },
  {
    code: "MP",
    name: "Northern Mariana Islands",
    dialCode: "+1",
  },
  {
    code: "NO",
    name: "Norway",
    dialCode: "+47",
  },
  {
    code: "OM",
    name: "Oman",
    dialCode: "+968",
  },
  {
    code: "PK",
    name: "Pakistan",
    dialCode: "+92",
  },
  {
    code: "PW",
    name: "Palau",
    dialCode: "+680",
  },
  {
    code: "PS",
    name: "Palestinian Territories",
    dialCode: "+970",
  },
  {
    code: "PA",
    name: "Panama",
    dialCode: "+507",
  },
  {
    code: "PG",
    name: "Papua New Guinea",
    dialCode: "+675",
  },
  {
    code: "PY",
    name: "Paraguay",
    dialCode: "+595",
  },
  {
    code: "PE",
    name: "Peru",
    dialCode: "+51",
  },
  {
    code: "PH",
    name: "Philippines",
    dialCode: "+63",
  },
  {
    code: "PN",
    name: "Pitcairn Islands",
    dialCode: "+64",
  },
  {
    code: "PL",
    name: "Poland",
    dialCode: "+48",
  },
  {
    code: "PT",
    name: "Portugal",
    dialCode: "+351",
  },
  {
    code: "PR",
    name: "Puerto Rico",
    dialCode: "+1",
  },
  {
    code: "QA",
    name: "Qatar",
    dialCode: "+974",
  },
  {
    code: "RE",
    name: "Réunion",
    dialCode: "+262",
  },
  {
    code: "RO",
    name: "Romania",
    dialCode: "+40",
  },
  {
    code: "RU",
    name: "Russia",
    dialCode: "+7",
  },
  {
    code: "RW",
    name: "Rwanda",
    dialCode: "+250",
  },
  {
    code: "WS",
    name: "Samoa",
    dialCode: "+685",
  },
  {
    code: "SM",
    name: "San Marino",
    dialCode: "+378",
  },
  {
    code: "ST",
    name: "São Tomé & Príncipe",
    dialCode: "+239",
  },
  {
    code: "SA",
    name: "Saudi Arabia",
    dialCode: "+966",
  },
  {
    code: "SN",
    name: "Senegal",
    dialCode: "+221",
  },
  {
    code: "RS",
    name: "Serbia",
    dialCode: "+381",
  },
  {
    code: "SC",
    name: "Seychelles",
    dialCode: "+248",
  },
  {
    code: "SL",
    name: "Sierra Leone",
    dialCode: "+232",
  },
  {
    code: "SG",
    name: "Singapore",
    dialCode: "+65",
  },
  {
    code: "SX",
    name: "Sint Maarten",
    dialCode: "+1",
  },
  {
    code: "SK",
    name: "Slovakia",
    dialCode: "+421",
  },
  {
    code: "SI",
    name: "Slovenia",
    dialCode: "+386",
  },
  {
    code: "SB",
    name: "Solomon Islands",
    dialCode: "+677",
  },
  {
    code: "SO",
    name: "Somalia",
    dialCode: "+252",
  },
  {
    code: "ZA",
    name: "South Africa",
    dialCode: "+27",
  },
  {
    code: "GS",
    name: "South Georgia & South Sandwich Islands",
    dialCode: "+500",
  },
  {
    code: "KR",
    name: "South Korea",
    dialCode: "+82",
  },
  {
    code: "SS",
    name: "South Sudan",
    dialCode: "+211",
  },
  {
    code: "ES",
    name: "Spain",
    dialCode: "+34",
  },
  {
    code: "LK",
    name: "Sri Lanka",
    dialCode: "+94",
  },
  {
    code: "BL",
    name: "St. Barthélemy",
    dialCode: "+590",
  },
  {
    code: "SH",
    name: "St. Helena",
    dialCode: "+290",
  },
  {
    code: "KN",
    name: "St. Kitts & Nevis",
    dialCode: "+1",
  },
  {
    code: "LC",
    name: "St. Lucia",
    dialCode: "+1",
  },
  {
    code: "MF",
    name: "St. Martin",
    dialCode: "+590",
  },
  {
    code: "PM",
    name: "St. Pierre & Miquelon",
    dialCode: "+508",
  },
  {
    code: "VC",
    name: "St. Vincent & Grenadines",
    dialCode: "+1",
  },
  {
    code: "SD",
    name: "Sudan",
    dialCode: "+249",
  },
  {
    code: "SR",
    name: "Suriname",
    dialCode: "+597",
  },
  {
    code: "SJ",
    name: "Svalbard & Jan Mayen",
    dialCode: "+47",
  },
  {
    code: "SE",
    name: "Sweden",
    dialCode: "+46",
  },
  {
    code: "CH",
    name: "Switzerland",
    dialCode: "+41",
  },
  {
    code: "SY",
    name: "Syria",
    dialCode: "+963",
  },
  {
    code: "TW",
    name: "Taiwan",
    dialCode: "+886",
  },
  {
    code: "TJ",
    name: "Tajikistan",
    dialCode: "+992",
  },
  {
    code: "TZ",
    name: "Tanzania",
    dialCode: "+255",
  },
  {
    code: "TH",
    name: "Thailand",
    dialCode: "+66",
  },
  {
    code: "TL",
    name: "Timor-Leste",
    dialCode: "+670",
  },
  {
    code: "TG",
    name: "Togo",
    dialCode: "+228",
  },
  {
    code: "TK",
    name: "Tokelau",
    dialCode: "+690",
  },
  {
    code: "TO",
    name: "Tonga",
    dialCode: "+676",
  },
  {
    code: "TT",
    name: "Trinidad & Tobago",
    dialCode: "+1",
  },
  {
    code: "TN",
    name: "Tunisia",
    dialCode: "+216",
  },
  {
    code: "TR",
    name: "Türkiye",
    dialCode: "+90",
  },
  {
    code: "TM",
    name: "Turkmenistan",
    dialCode: "+993",
  },
  {
    code: "TC",
    name: "Turks & Caicos Islands",
    dialCode: "+1",
  },
  {
    code: "TV",
    name: "Tuvalu",
    dialCode: "+688",
  },
  {
    code: "UM",
    name: "U.S. Outlying Islands",
    dialCode: "+1",
  },
  {
    code: "VI",
    name: "U.S. Virgin Islands",
    dialCode: "+1",
  },
  {
    code: "UG",
    name: "Uganda",
    dialCode: "+256",
  },
  {
    code: "UA",
    name: "Ukraine",
    dialCode: "+380",
  },
  {
    code: "AE",
    name: "United Arab Emirates",
    dialCode: "+971",
  },
  {
    code: "GB",
    name: "United Kingdom",
    dialCode: "+44",
  },
  {
    code: "US",
    name: "United States",
    dialCode: "+1",
  },
  {
    code: "UY",
    name: "Uruguay",
    dialCode: "+598",
  },
  {
    code: "UZ",
    name: "Uzbekistan",
    dialCode: "+998",
  },
  {
    code: "VU",
    name: "Vanuatu",
    dialCode: "+678",
  },
  {
    code: "VA",
    name: "Vatican City",
    dialCode: "+379",
  },
  {
    code: "VE",
    name: "Venezuela",
    dialCode: "+58",
  },
  {
    code: "VN",
    name: "Vietnam",
    dialCode: "+84",
  },
  {
    code: "WF",
    name: "Wallis & Futuna",
    dialCode: "+681",
  },
  {
    code: "EH",
    name: "Western Sahara",
    dialCode: "+212",
  },
  {
    code: "YE",
    name: "Yemen",
    dialCode: "+967",
  },
  {
    code: "ZM",
    name: "Zambia",
    dialCode: "+260",
  },
  {
    code: "ZW",
    name: "Zimbabwe",
    dialCode: "+263",
  },
] as const;

const COUNTRY_MAP = new Map<string, CountryItem>(
  COUNTRIES.map((c) => [c.code, c]),
);

/**
 * Lookup a country item by its ISO 3166-1 alpha-2 code.
 */
export function getCountryByCode(
  code: string | null | undefined,
): CountryItem | undefined {
  if (!code) return undefined;
  return COUNTRY_MAP.get(code.trim().toUpperCase());
}

/**
 * Fast search / filter across countries matching name, code, or dialCode with relevance ranking.
 */
export function searchCountries(
  query: string,
  countryList: readonly CountryItem[] = COUNTRIES,
): CountryItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [...countryList];
  }

  const cleanDigits = trimmed.replace(/[^0-9]/g, "");

  const matchedWithRank: Array<{ country: CountryItem; rank: number }> = [];

  for (const country of countryList) {
    const codeLower = country.code.toLowerCase();
    const nameLower = country.name.toLowerCase();
    const localized = getLocalizedCountryName(
      country.code,
      country.name,
    ).toLowerCase();

    // 1. Exact code match (e.g. query "US" matches United States immediately)
    if (codeLower === trimmed) {
      matchedWithRank.push({ country, rank: 0 });
      continue;
    }

    // 2. Prefix code match (e.g. query "U" matches US, UA...)
    if (codeLower.startsWith(trimmed)) {
      matchedWithRank.push({ country, rank: 1 });
      continue;
    }

    // 3. Prefix name match (e.g. query "Slov" matches Slovakia)
    if (nameLower.startsWith(trimmed) || localized.startsWith(trimmed)) {
      matchedWithRank.push({ country, rank: 2 });
      continue;
    }

    // 4. Word boundary / substring name match
    if (nameLower.includes(trimmed) || localized.includes(trimmed)) {
      matchedWithRank.push({ country, rank: 3 });
      continue;
    }

    // 5. Dialing code match
    if (country.dialCode) {
      if (country.dialCode.toLowerCase().includes(trimmed)) {
        matchedWithRank.push({ country, rank: 4 });
        continue;
      }
      if (
        cleanDigits.length > 0 &&
        country.dialCode.replace(/[^0-9]/g, "").includes(cleanDigits)
      ) {
        matchedWithRank.push({ country, rank: 4 });
        continue;
      }
    }
  }

  // Sort primarily by relevance rank, secondary by alphabetical name
  matchedWithRank.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.country.name.localeCompare(b.country.name, "en");
  });

  return matchedWithRank.map((item) => item.country);
}
