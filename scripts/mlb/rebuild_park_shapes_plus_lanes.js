import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "website", "data", "mlb_park_shapes.json");

const DEFAULT_LANES = {
  leftyPull: "M210 230 L350 101 L315 95 L277 79 L238 69 L210 66 L255 190 Z",
  rightyPull: "M210 230 L70 101 L105 95 L143 79 L182 69 L210 66 L165 190 Z"
};

function park(dimensions, wallPath, lanes = DEFAULT_LANES) {
  return { dimensions, wallPath, lanes };
}

const parks = {
  "Citi Field": park(
    { lf: 335, lcf: 375, cf: 408, rcf: 375, rf: 330 },
    "M70 101 L91 76 L122 61 L162 50 L202 46 L236 51 L276 63 L315 80 L350 101"
  ),
  "Globe Life Field": park(
    { lf: 329, lcf: 372, cf: 407, rcf: 374, rf: 326 },
    "M70 101 L92 78 L130 63 L170 54 L210 48 L250 55 L291 68 L323 84 L350 101"
  ),
  "Nationals Park": park(
    { lf: 336, lcf: 377, cf: 402, rcf: 370, rf: 335 },
    "M70 101 L94 75 L130 60 L169 51 L210 47 L250 53 L289 64 L324 82 L350 101"
  ),
  "Oriole Park at Camden Yards": park(
    { lf: 333, lcf: 364, cf: 410, rcf: 373, rf: 318 },
    "M70 101 L93 78 L123 67 L158 56 L205 45 L249 54 L288 68 L323 84 L350 101"
  ),
  "Rate Field": park(
    { lf: 330, lcf: 375, cf: 400, rcf: 375, rf: 335 },
    "M70 101 L91 80 L126 63 L166 53 L210 48 L254 53 L294 64 L327 82 L350 101"
  ),
  "Progressive Field": park(
    { lf: 325, lcf: 370, cf: 410, rcf: 375, rf: 325 },
    "M70 101 L91 78 L127 62 L169 51 L210 43 L251 52 L292 65 L326 83 L350 101"
  ),
  "Daikin Park": park(
    { lf: 315, lcf: 362, cf: 409, rcf: 373, rf: 326 },
    "M70 101 L86 78 L118 64 L162 51 L210 43 L253 53 L294 66 L328 84 L350 101"
  ),
  "PNC Park": park(
    { lf: 325, lcf: 389, cf: 399, rcf: 375, rf: 320 },
    "M70 101 L93 73 L137 58 L181 47 L210 45 L246 51 L286 67 L323 83 L350 101"
  ),
  "Yankee Stadium": park(
    { lf: 318, lcf: 399, cf: 408, rcf: 385, rf: 314 },
    "M70 101 L88 74 L130 57 L174 47 L210 43 L250 50 L294 64 L331 83 L350 101"
  ),
  "Fenway Park": park(
    { lf: 310, lcf: 379, cf: 390, rcf: 420, rf: 302 },
    "M70 101 L77 62 L118 56 L160 50 L200 49 L244 54 L291 68 L331 83 L350 101"
  ),
  "Dodger Stadium": park(
    { lf: 330, lcf: 385, cf: 395, rcf: 385, rf: 330 },
    "M70 101 L92 76 L128 61 L168 52 L210 49 L252 52 L292 61 L328 76 L350 101"
  ),
  "Coors Field": park(
    { lf: 347, lcf: 390, cf: 415, rcf: 375, rf: 350 },
    "M70 101 L98 70 L141 54 L184 43 L210 39 L246 45 L288 59 L326 78 L350 101"
  ),
  "Wrigley Field": park(
    { lf: 355, lcf: 368, cf: 400, rcf: 368, rf: 353 },
    "M70 101 L97 77 L132 64 L170 54 L210 49 L250 54 L288 64 L323 77 L350 101"
  ),
  "T-Mobile Park": park(
    { lf: 331, lcf: 378, cf: 401, rcf: 381, rf: 326 },
    "M70 101 L92 76 L128 61 L168 50 L210 46 L252 51 L292 63 L327 82 L350 101"
  ),
  "Petco Park": park(
    { lf: 334, lcf: 390, cf: 396, rcf: 391, rf: 322 },
    "M70 101 L92 73 L134 57 L178 49 L210 48 L246 51 L291 63 L328 83 L350 101"
  ),
  "Oracle Park": park(
    { lf: 339, lcf: 399, cf: 391, rcf: 421, rf: 309 },
    "M70 101 L95 72 L139 55 L183 48 L210 50 L246 58 L292 70 L331 86 L350 101"
  ),
  "Busch Stadium": park(
    { lf: 336, lcf: 375, cf: 400, rcf: 375, rf: 335 },
    "M70 101 L94 77 L130 62 L169 52 L210 48 L251 52 L290 62 L326 80 L350 101"
  ),
  "Target Field": park(
    { lf: 339, lcf: 377, cf: 411, rcf: 367, rf: 328 },
    "M70 101 L95 76 L132 61 L174 49 L210 42 L249 52 L289 66 L326 84 L350 101"
  ),
  "Citizens Bank Park": park(
    { lf: 329, lcf: 374, cf: 401, rcf: 369, rf: 330 },
    "M70 101 L91 76 L126 62 L168 51 L210 47 L252 53 L290 65 L326 82 L350 101"
  ),
  "Great American Ball Park": park(
    { lf: 328, lcf: 379, cf: 404, rcf: 370, rf: 325 },
    "M70 101 L91 75 L129 59 L170 49 L210 45 L250 53 L291 66 L326 84 L350 101"
  ),
  "Comerica Park": park(
    { lf: 345, lcf: 370, cf: 420, rcf: 365, rf: 330 },
    "M70 101 L100 78 L137 63 L177 49 L210 38 L247 51 L287 66 L324 83 L350 101"
  ),
  "Kauffman Stadium": park(
    { lf: 330, lcf: 387, cf: 410, rcf: 387, rf: 330 },
    "M70 101 L94 73 L137 56 L180 44 L210 41 L240 44 L283 56 L326 73 L350 101"
  ),
  "American Family Field": park(
    { lf: 344, lcf: 371, cf: 400, rcf: 374, rf: 345 },
    "M70 101 L98 78 L134 64 L172 53 L210 48 L248 53 L286 64 L322 78 L350 101"
  ),
  "Rogers Centre": park(
    { lf: 328, lcf: 375, cf: 400, rcf: 375, rf: 328 },
    "M70 101 L91 78 L128 63 L168 53 L210 48 L252 53 L292 63 L329 78 L350 101"
  ),
  "loanDepot park": park(
    { lf: 344, lcf: 386, cf: 400, rcf: 387, rf: 335 },
    "M70 101 L98 74 L138 58 L180 49 L210 47 L242 49 L283 60 L324 78 L350 101"
  ),
  "Angel Stadium": park(
    { lf: 347, lcf: 390, cf: 396, rcf: 370, rf: 350 },
    "M70 101 L99 74 L141 57 L181 50 L210 49 L247 52 L286 64 L322 79 L350 101"
  ),
  "Truist Park": park(
    { lf: 335, lcf: 385, cf: 400, rcf: 375, rf: 325 },
    "M70 101 L93 75 L134 58 L176 50 L210 47 L250 52 L291 65 L328 84 L350 101"
  ),
  "Chase Field": park(
    { lf: 330, lcf: 374, cf: 407, rcf: 374, rf: 334 },
    "M70 101 L92 77 L128 62 L169 50 L210 44 L251 50 L292 62 L328 80 L350 101"
  ),
  "Sutter Health Park": park(
    { lf: 330, lcf: 375, cf: 403, rcf: 375, rf: 325 },
    "M70 101 L92 76 L128 61 L169 50 L210 45 L252 51 L293 64 L328 83 L350 101"
  ),
  "George M. Steinbrenner Field": park(
    { lf: 318, lcf: 399, cf: 408, rcf: 385, rf: 314 },
    "M70 101 L88 74 L130 57 L174 47 L210 43 L250 50 L294 64 L331 83 L350 101"
  )
};

fs.writeFileSync(OUT, JSON.stringify(parks, null, 2));
console.log("Rebuilt park shapes with pull lanes");
console.log("Parks:", Object.keys(parks).length);
console.log("Saved:", OUT);
