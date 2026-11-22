import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";

/**
 * FixMate database seed — `node seed.js`.
 *
 * Idempotent: every document is matched on a natural key and upserted, so
 * running it twice leaves exactly the same data behind (no duplicates, no
 * throwaway `_id`s for the accounts). Natural keys:
 *
 *   user     → email
 *   services → technicianEmail + title
 *   bookings → customerEmail + serviceId
 *   payments → bookingId (also unique-indexed)
 *
 * It writes the same document shapes the API produces, because the Express
 * routes read these fields directly (`shapeService` / `shapeBooking` /
 * `shapePayment`) — see `.project/CONTRACT.md` §2.
 */

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
}
const DB_NAME = process.env.DB_NAME || "fixmate";

/** Every seeded account shares one password so an examiner can move between roles. */
const PASSWORD = "FixMate1";

const IMAGE_ENDPOINT = "https://coresg-normal.trae.ai/api/ide/v1/text_to_image";
const img = (prompt, size = "landscape_4_3") =>
  `${IMAGE_ENDPOINT}?prompt=${encodeURIComponent(prompt)}&image_size=${size}`;

const DAY = 24 * 60 * 60 * 1000;
/** Stable-ish timestamps: `daysAgo(6)` always lands at 06:00 UTC. */
function daysAgo(days, hour = 6) {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

/**
 * BetterAuth's credential hash, replicated exactly so a seeded account can sign
 * in through the normal email/password flow. Source of truth:
 * `better-auth/dist/crypto/password.mjs` → scrypt(N=16384, r=16, p=1, dkLen=64),
 * stored as `salt:key` with both halves hex.
 */
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  });
  return `${salt}:${key.toString("hex")}`;
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

const TECHNICIAN_A = "technician@fixmate.test";
const TECHNICIAN_B = "ali@fixmate.test";
const CUSTOMER_A = "customer@fixmate.test";
const CUSTOMER_B = "maya@fixmate.test";

const USERS = [
  {
    email: "admin@fixmate.test",
    name: "Amara Okonkwo",
    role: "admin",
    phone: "+1 (415) 555-0110",
    area: "Bay Area, CA",
    bio: "Keeps the marketplace honest — approves listings, watches the queue and steps in when a repair goes sideways.",
    image: img(
      "Head and shoulders portrait of a calm Black woman operations manager in a dark teal shirt, plain pale studio background, soft daylight, documentary business portrait, no text",
      "square"
    ),
  },
  {
    email: TECHNICIAN_A,
    name: "Dilnoza Karimova",
    role: "technician",
    phone: "+1 (415) 555-0142",
    area: "Mission District, SF",
    bio: "Eight years on smartphones, laptops and TVs. Board-level repair first, parts swaps only when the board is genuinely gone.",
    image: img(
      "Head and shoulders portrait of a confident Central Asian woman electronics technician in dark teal workwear, tidy workshop bench blurred behind, natural side light, documentary portrait, no text",
      "square"
    ),
  },
  {
    email: TECHNICIAN_B,
    name: "Ali Reza Nasser",
    role: "technician",
    phone: "+1 (415) 555-0176",
    area: "Oakland, CA",
    bio: "Large appliances and home wiring. If a fridge or an AC has a pressure or load problem, I'd rather measure it than guess.",
    image: img(
      "Head and shoulders portrait of a friendly Middle Eastern appliance technician in dark teal workwear with a tool bag strap visible, garage workshop behind, warm daylight, documentary portrait, no text",
      "square"
    ),
  },
  {
    email: CUSTOMER_A,
    name: "Sofia Marchetti",
    role: "customer",
    phone: "+1 (415) 555-0188",
    area: "Noe Valley, SF",
    bio: "Renting a flat with a lot of ageing appliances, so I book repairs rather than replacements.",
    image: img(
      "Head and shoulders portrait of a cheerful Italian woman in her thirties in a soft knitted jumper, bright apartment wall behind, natural window light, warm lifestyle portrait, no text",
      "square"
    ),
  },
  {
    email: CUSTOMER_B,
    name: "Maya Chen",
    role: "customer",
    phone: "+1 (415) 555-0193",
    area: "Alameda, CA",
    bio: "Runs a small design studio out of a converted garage and keeps the machines that matter on a service plan.",
    image: img(
      "Head and shoulders portrait of a calm East Asian woman small-business owner in a linen shirt, light studio space blurred behind, soft daylight, documentary portrait, no text",
      "square"
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Services — 13 approved (all 7 categories), 1 pending, 1 rejected    */
/* ------------------------------------------------------------------ */

const SERVICES = [
  {
    title: "Cracked Screen Replacement — Same Day",
    category: "Smartphone",
    basePrice: 89,
    estimatedDuration: "45–60 min",
    serviceMode: "Home Visit",
    serviceArea: "Bay Area, CA",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 4.8,
    ratingCount: 126,
    createdDaysAgo: 40,
    description:
      "Original-spec OLED or LCD panel swapped in front of you, the adhesive resealed and a full touch-digitizer test run before I pack up. If the exact panel isn't in stock I tell you the price and the wait first — nothing gets ordered without your yes.",
    image: img(
      "Macro photograph of a technician's gloved hands lifting a fresh smartphone display panel into place over an open phone chassis on a pale workbench, precision screwdrivers beside it, soft daylight, shallow depth of field, product repair photography, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Battery Health Service & Deep Clean",
    category: "Smartphone",
    basePrice: 59,
    estimatedDuration: "30–40 min",
    serviceMode: "Shop Drop-off",
    serviceArea: "Mission District, SF",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 4.6,
    ratingCount: 88,
    createdDaysAgo: 37,
    description:
      "A fresh high-cycle battery, the charging port and speaker grilles scrubbed out, and a battery-health readout before and after so the change is on the record. Bring it in before 5pm and it's back in your hand the same day.",
    image: img(
      "Overhead shot of an opened smartphone on a clean grey mat with a new battery module laid beside it and a small brush and tweezers nearby, soft studio light, organised and precise, product teardown photography, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Laptop Keyboard & Hinge Rebuild",
    category: "Laptop & PC",
    basePrice: 129,
    estimatedDuration: "2–3 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "SoMa, SF",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 4.7,
    ratingCount: 64,
    createdDaysAgo: 33,
    description:
      "Dropped keys, a cracked hinge cover, or a lid that no longer sits square. I strip the chassis, fit the new hinge set and keyboard, re-seat every ribbon cable, then run a thirty-minute stress test before handover.",
    image: img(
      "Open laptop on a repair bench with the keyboard assembly lifted and a replacement hinge set resting beside the chassis, small screwdrivers arranged neatly, cool daylight, technical documentary photograph, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "PC Not Booting? Diagnostic & Fix",
    category: "Laptop & PC",
    basePrice: 75,
    estimatedDuration: "1–2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Oakland, CA",
    technicianEmail: TECHNICIAN_B,
    ratingAverage: 4.5,
    ratingCount: 51,
    createdDaysAgo: 30,
    description:
      "No display, a boot loop, or a machine that dies under load. I test the power supply, memory, storage health and thermals, then explain in plain language what actually failed. The diagnostic fee comes off the repair if you go ahead.",
    image: img(
      "Desktop PC tower with its side panel off on a workbench, RAM sticks and a power supply unit laid out beside it, multimeter leads on the bench, clean garage workshop, cool daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Split AC Service & Gas Top-Up",
    category: "AC",
    basePrice: 119,
    estimatedDuration: "2 hours",
    serviceMode: "Home Visit",
    serviceArea: "Berkeley, CA",
    technicianEmail: TECHNICIAN_B,
    ratingAverage: 4.9,
    ratingCount: 143,
    createdDaysAgo: 27,
    description:
      "Filters, blower wheel and outdoor coil washed, drain line cleared, then refrigerant topped up with a pressure reading taken before and after. Cooling is measured at the vent so you see the difference in numbers, not adjectives.",
    image: img(
      "Indoor split air conditioner unit with its front panel open and a clean filter held up beside it, service gauges connected to the outdoor unit visible through a window, bright room, soft daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "AC Filter Deep Clean & Coil Wash",
    category: "AC",
    basePrice: 79,
    estimatedDuration: "90 min",
    serviceMode: "Home Visit",
    serviceArea: "Sunset District, SF",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 4.4,
    ratingCount: 37,
    createdDaysAgo: 24,
    description:
      "A seasonal service for units that still run but smell musty or cool weakly. Covers filter wash, coil cleaning, drain clearing and a leak check — no refrigerant work, so it stays quick and affordable.",
    image: img(
      "Technician's gloved hands rinsing a dusty air conditioner filter under a tap in a neat utility area, clean coiled hose beside the sink, bright daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Fridge Cooling Loss Repair",
    category: "Refrigerator",
    basePrice: 135,
    estimatedDuration: "2–3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Daly City, CA",
    technicianEmail: TECHNICIAN_B,
    ratingAverage: 4.6,
    ratingCount: 72,
    createdDaysAgo: 21,
    description:
      "A warm fridge, a freezer that ices over, or a compressor that clicks without starting. I check the thermostat, defrost system, fan motors and gas charge, then quote the parts before anything is replaced.",
    image: img(
      "Open refrigerator with its shelves pulled forward and a technician's multimeter resting on the door, thermometer probe inside, bright modern kitchen, clean daylight, appliance service photograph, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "TV Backlight & Power Board Fix",
    category: "TV",
    basePrice: 149,
    estimatedDuration: "2 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "Richmond, SF",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 4.5,
    ratingCount: 45,
    createdDaysAgo: 18,
    description:
      "A dark screen with sound, flickering bands, or a set that won't power on. Boards are tested on the bench and the failed strip or capacitor is replaced — no whole-panel swaps unless that genuinely works out cheaper.",
    image: img(
      "Large flat screen television lying face down on a padded bench with its back panel removed, exposed power board and backlight strips visible, soldering iron in frame, soft workshop light, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "TV Wall Mount + Cable Tidy",
    category: "TV",
    basePrice: 95,
    estimatedDuration: "1 hour",
    serviceMode: "Home Visit",
    serviceArea: "Alameda, CA",
    technicianEmail: TECHNICIAN_B,
    ratingAverage: 4.3,
    ratingCount: 29,
    createdDaysAgo: 15,
    description:
      "Your bracket fitted into studs or the right anchors, the screen levelled, and every cable run through trunking or a hidden channel. I bring the stud finder, the level and the fixings — you just pick the wall.",
    image: img(
      "Technician on a step stool levelling a wall-mounted flat screen television in a bright minimal living room, cable trunking running neatly down the wall, daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Washing Machine Drum Bearing Replacement",
    category: "Washing Machine",
    basePrice: 155,
    estimatedDuration: "3 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "Excelsior, SF",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 4.7,
    ratingCount: 33,
    createdDaysAgo: 12,
    description:
      "That jet-engine roar on spin almost always means worn drum bearings. I split the drum, press in new bearings and a fresh seal, then run a full hot cycle and a spin test with the machine empty before it goes back to you.",
    image: img(
      "Washing machine drum removed and resting on a workshop floor beside a new bearing and seal kit, technician's gloved hand pointing at the bearing seat, clean daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Washer Drain Pump & Hose Swap",
    category: "Washing Machine",
    basePrice: 89,
    estimatedDuration: "90 min",
    serviceMode: "Home Visit",
    serviceArea: "San Mateo, CA",
    technicianEmail: TECHNICIAN_B,
    ratingAverage: 4.4,
    ratingCount: 41,
    createdDaysAgo: 9,
    description:
      "Standing water after a wash, or an error code that won't clear. I clear the filter housing, replace the drain pump and hose, and check the level sensor so the machine fills and empties properly again.",
    image: img(
      "Front loading washing machine tipped forward with the filter housing access panel open, a replacement drain pump held in a gloved hand beside it, bright utility room, clean daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Full Home Wiring Safety Audit",
    category: "Electrical",
    basePrice: 199,
    estimatedDuration: "3 hours",
    serviceMode: "Home Visit",
    serviceArea: "Bay Area, CA",
    technicianEmail: TECHNICIAN_B,
    ratingAverage: 4.8,
    ratingCount: 57,
    createdDaysAgo: 6,
    description:
      "A room-by-room check of the consumer unit, socket earthing, RCD trip times and load balance, finishing with a written report and photographs. Worth doing before a renovation, or when you're buying an older property.",
    image: img(
      "Neat open electrical distribution board with labelled circuit breakers and a voltage tester held against a wire, clipboard with a checklist resting on a nearby surface, clean utility wall, soft daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Switchboard & Socket Repair",
    category: "Electrical",
    basePrice: 69,
    estimatedDuration: "1 hour",
    serviceMode: "Home Visit",
    serviceArea: "Hayes Valley, SF",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 4.5,
    ratingCount: 26,
    createdDaysAgo: 3,
    description:
      "Dead sockets, a breaker that trips on one circuit, or a light switch that buzzes. Diagnostics are done with the circuit isolated, and any replacement breaker or socket is matched to your board — no mixed-brand shortcuts.",
    image: img(
      "Close up of a technician's hand using a screwdriver on a wall socket faceplate with the power isolated and a tester beside it, visible wiring neat and colour-coded, soft daylight, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Tablet Screen & Digitizer Replacement",
    category: "Smartphone",
    basePrice: 109,
    estimatedDuration: "1–2 hours",
    serviceMode: "Shop Drop-off",
    serviceArea: "Mission District, SF",
    technicianEmail: TECHNICIAN_A,
    ratingAverage: 0,
    ratingCount: 0,
    createdDaysAgo: 2,
    approvalStatus: "pending",
    isAvailable: true,
    description:
      "Cracked glass over a working display, or a digitizer that misses touches along one edge. The glass and digitizer are replaced as a single assembly and the frame is checked for bend before the new panel is bonded in.",
    image: img(
      "Tablet lying face down on a padded mat with its glass panel partly separated and a suction cup tool attached, spudger and tape beside it, soft studio light, product repair photography, no text",
      "landscape_4_3"
    ),
  },
  {
    title: "Microwave Magnetron Replacement",
    category: "Electrical",
    basePrice: 85,
    estimatedDuration: "90 min",
    serviceMode: "Shop Drop-off",
    serviceArea: "Oakland, CA",
    technicianEmail: TECHNICIAN_B,
    ratingAverage: 0,
    ratingCount: 0,
    createdDaysAgo: 5,
    approvalStatus: "rejected",
    isAvailable: false,
    description:
      "No heat, arcing, or a loud hum — usually the magnetron or the high-voltage diode. The part is replaced with a tested unit and the door seals and interlocks are inspected with a leakage check before it's returned.",
    image: img(
      "Countertop microwave with its casing removed on a workbench, a magnetron component held beside the open chassis, screwdrivers and a tester nearby, clean daylight, appliance service photograph, no text",
      "landscape_4_3"
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Bookings — every branch of the status machine (CONTRACT §3)         */
/* ------------------------------------------------------------------ */

/**
 * `history` records the legal path the request took, so the customer timeline
 * renders from real data rather than a hard-coded assumption.
 */
const BOOKINGS = [
  {
    customerEmail: CUSTOMER_A,
    serviceTitle: "Cracked Screen Replacement — Same Day",
    status: "completed",
    paymentStatus: "paid",
    finalAmount: 89,
    customerPhone: "+1 (415) 555-0188",
    address: "412 Sanchez Street, Apt 3, San Francisco, CA 94114",
    problemDescription:
      "Dropped the phone on the kitchen tiles and the whole screen is a spiderweb. Touch still works on the lower half but the top corner is unresponsive and the glass is lifting away from the frame.",
    createdDaysAgo: 24,
    preferredDateDaysAgo: 22,
    history: ["requested", "accepted", "in-progress", "completed"],
    paidDaysAgo: 21,
    transactionId: "pi_seed_screen_sofia",
  },
  {
    customerEmail: CUSTOMER_B,
    serviceTitle: "Full Home Wiring Safety Audit",
    status: "completed",
    paymentStatus: "paid",
    finalAmount: 199,
    customerPhone: "+1 (415) 555-0193",
    address: "27 Bay Street, Studio B, Alameda, CA 94501",
    problemDescription:
      "Converting the garage into a working studio and the electrician needs to know what the existing board can actually take. Two sockets on the far wall also feel warm when the heater runs.",
    createdDaysAgo: 21,
    preferredDateDaysAgo: 19,
    history: ["requested", "accepted", "in-progress", "completed"],
    paidDaysAgo: 18,
    transactionId: "pi_seed_wiring_maya",
  },
  {
    customerEmail: CUSTOMER_A,
    serviceTitle: "TV Backlight & Power Board Fix",
    status: "completed",
    paymentStatus: "unpaid",
    finalAmount: 149,
    customerPhone: "+1 (415) 555-0188",
    address: "412 Sanchez Street, Apt 3, San Francisco, CA 94114",
    problemDescription:
      "The screen goes completely dark after about ten minutes but the sound keeps playing, and if I switch it off and on again it comes back for a few minutes. It's a 55-inch set from 2019.",
    createdDaysAgo: 16,
    preferredDateDaysAgo: 14,
    history: ["requested", "accepted", "in-progress", "completed"],
  },
  {
    customerEmail: CUSTOMER_B,
    serviceTitle: "Washer Drain Pump & Hose Swap",
    status: "rejected",
    paymentStatus: "unpaid",
    finalAmount: 89,
    customerPhone: "+1 (415) 555-0193",
    address: "27 Bay Street, Studio B, Alameda, CA 94501",
    problemDescription:
      "The drum stays half full of water at the end of every cycle and there's a soft grinding noise while it tries to drain. I've already cleaned the filter and it made no difference.",
    createdDaysAgo: 12,
    preferredDateDaysAgo: 10,
    history: ["requested", "rejected"],
  },
  {
    customerEmail: CUSTOMER_A,
    serviceTitle: "TV Wall Mount + Cable Tidy",
    status: "cancelled",
    paymentStatus: "unpaid",
    finalAmount: 95,
    customerPhone: "+1 (415) 555-0188",
    address: "412 Sanchez Street, Apt 3, San Francisco, CA 94114",
    problemDescription:
      "I need the television moved onto the chimney breast with the cables hidden, but the landlord has to approve drilling into the wall first so I may need to hold off on this one.",
    createdDaysAgo: 9,
    preferredDateDaysAgo: 7,
    history: ["requested", "cancelled"],
  },
  {
    customerEmail: CUSTOMER_A,
    serviceTitle: "Laptop Keyboard & Hinge Rebuild",
    status: "in-progress",
    paymentStatus: "unpaid",
    finalAmount: 129,
    customerPhone: "+1 (415) 555-0188",
    address: "412 Sanchez Street, Apt 3, San Francisco, CA 94114",
    problemDescription:
      "Three keys on the left-hand side have stopped registering and the lid has started to rock when I open it, which I think means the hinge is cracked on the inside of the chassis.",
    createdDaysAgo: 6,
    preferredDateDaysAgo: 4,
    history: ["requested", "accepted", "in-progress"],
  },
  {
    customerEmail: CUSTOMER_A,
    serviceTitle: "Fridge Cooling Loss Repair",
    status: "accepted",
    paymentStatus: "unpaid",
    finalAmount: 135,
    customerPhone: "+1 (415) 555-0188",
    address: "412 Sanchez Street, Apt 3, San Francisco, CA 94114",
    problemDescription:
      "The fridge half is barely cool while the freezer is fine, and there's a block of ice building up at the back of the freezer compartment. It's a frost-free model about eight years old.",
    createdDaysAgo: 3,
    preferredDateDaysAgo: -1,
    history: ["requested", "accepted"],
  },
  {
    customerEmail: CUSTOMER_A,
    serviceTitle: "Split AC Service & Gas Top-Up",
    status: "requested",
    paymentStatus: "unpaid",
    finalAmount: 119,
    customerPhone: "+1 (415) 555-0188",
    address: "412 Sanchez Street, Apt 3, San Francisco, CA 94114",
    problemDescription:
      "Two indoor units run for hours without really cooling the rooms and one of them smells slightly damp when it first starts. Happy to book both units in the same visit.",
    createdDaysAgo: 1,
    preferredDateDaysAgo: -6,
    history: ["requested"],
  },
];

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

const client = new MongoClient(uri, { appName: "FixMate" });

async function seedUsers(db) {
  const users = db.collection("user");
  const accounts = db.collection("account");

  for (const spec of USERS) {
    const now = new Date();
    const existing = await users.findOne({ email: spec.email });

    let _id;
    if (existing) {
      _id = existing._id;
      await users.updateOne(
        { _id },
        {
          $set: {
            name: spec.name,
            role: spec.role,
            phone: spec.phone,
            area: spec.area,
            bio: spec.bio,
            image: spec.image,
            updatedAt: now,
          },
        }
      );
    } else {
      _id = new ObjectId();
      await users.insertOne({
        _id,
        name: spec.name,
        email: spec.email,
        emailVerified: true,
        image: spec.image,
        role: spec.role,
        phone: spec.phone,
        area: spec.area,
        bio: spec.bio,
        createdAt: now,
        updatedAt: now,
      });
    }

    // The credential row is what sign-in actually reads. Only created when it's
    // missing, so re-running the seed never clobbers a password you changed.
    const account = await accounts.findOne({ userId: _id, providerId: "credential" });
    if (!account) {
      await accounts.insertOne({
        _id: new ObjectId(),
        userId: _id,
        accountId: String(_id),
        providerId: "credential",
        password: hashPassword(PASSWORD),
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

async function seedServices(db) {
  const services = db.collection("services");
  const docs = new Map();

  for (const spec of SERVICES) {
    const technicianName =
      USERS.find((user) => user.email === spec.technicianEmail)?.name ?? "FixMate Technician";
    const createdAt = daysAgo(spec.createdDaysAgo);
    const doc = {
      title: spec.title,
      category: spec.category,
      description: spec.description,
      image: spec.image,
      basePrice: spec.basePrice,
      estimatedDuration: spec.estimatedDuration,
      serviceMode: spec.serviceMode,
      serviceArea: spec.serviceArea,
      technicianName,
      technicianEmail: spec.technicianEmail,
      approvalStatus: spec.approvalStatus ?? "approved",
      isAvailable: spec.isAvailable ?? true,
      ratingAverage: spec.ratingAverage,
      ratingCount: spec.ratingCount,
    };

    const saved = await services.findOneAndUpdate(
      { technicianEmail: spec.technicianEmail, title: spec.title },
      { $set: doc, $setOnInsert: { createdAt } },
      { upsert: true, returnDocument: "after" }
    );

    docs.set(spec.title, saved);
  }

  return docs;
}

async function seedBookings(db, serviceDocs) {
  const bookings = db.collection("bookings");
  const payments = db.collection("payments");
  const written = new Map();

  for (const spec of BOOKINGS) {
    const service = serviceDocs.get(spec.serviceTitle);
    if (!service) throw new Error(`Booking references unknown service "${spec.serviceTitle}".`);

    const customerName = USERS.find((user) => user.email === spec.customerEmail)?.name ?? "";
    const createdAt = daysAgo(spec.createdDaysAgo);

    // Each status move happened a little after the last, so the timeline reads
    // in order rather than everything landing on one timestamp.
    const statusHistory = spec.history.map((status, index) => ({
      status,
      changedAt: new Date(createdAt.getTime() + index * 9 * 60 * 60 * 1000),
    }));

    const doc = {
      serviceId: service._id,
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      basePrice: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName,
      customerEmail: spec.customerEmail,
      customerPhone: spec.customerPhone,
      address: spec.address,
      preferredDate: daysAgo(spec.preferredDateDaysAgo, 10),
      problemDescription: spec.problemDescription,
      status: spec.status,
      finalAmount: spec.finalAmount,
      paymentStatus: spec.paymentStatus,
      statusHistory,
      createdAt,
    };

    const saved = await bookings.findOneAndUpdate(
      { customerEmail: spec.customerEmail, serviceId: service._id },
      { $set: doc },
      { upsert: true, returnDocument: "after" }
    );

    written.set(spec.serviceTitle, saved);

    if (spec.paymentStatus === "paid" && spec.transactionId) {
      await payments.findOneAndUpdate(
        { bookingId: saved._id },
        {
          $set: {
            bookingId: saved._id,
            serviceTitle: saved.serviceTitle,
            customerName: saved.customerName,
            customerEmail: saved.customerEmail,
            technicianName: saved.technicianName,
            technicianEmail: saved.technicianEmail,
            amount: saved.finalAmount,
            currency: "usd",
            transactionId: spec.transactionId,
            stripeSessionId: `cs_test_seed_${spec.transactionId}`,
            paymentStatus: "paid",
            paidAt: daysAgo(spec.paidDaysAgo ?? spec.createdDaysAgo, 14),
          },
        },
        { upsert: true, returnDocument: "after" }
      );
    }
  }

  return written;
}

async function main() {
  await client.connect();
  const db = client.db(DB_NAME);

  await seedUsers(db);
  const serviceDocs = await seedServices(db);
  const bookingDocs = await seedBookings(db, serviceDocs);

  const [users, services, bookings, payments] = await Promise.all([
    db.collection("user").countDocuments(),
    db.collection("services").countDocuments(),
    db.collection("bookings").countDocuments(),
    db.collection("payments").countDocuments(),
  ]);

  console.log(`Seeded database "${DB_NAME}" — ${uri.replace(/\/\/[^@]+@/, "//***@")}`);
  console.log(`  user      ${users} documents (${USERS.length} from this seed)`);
  console.log(`  services  ${services} documents (${serviceDocs.size} from this seed)`);
  console.log(`  bookings  ${bookings} documents (${bookingDocs.size} from this seed)`);
  console.log(`  payments  ${payments} documents`);
  console.log("");
  console.log("Sign in with any of these (password for all three: " + PASSWORD + ")");
  console.log(`  admin       admin@fixmate.test       Amara Okonkwo`);
  console.log(`  technician  ${TECHNICIAN_A}   Dilnoza Karimova`);
  console.log(`  customer    ${CUSTOMER_A}     Sofia Marchetti`);
  console.log("");
  console.log("Also seeded:");
  console.log(`  technician  ${TECHNICIAN_B}           Ali Reza Nasser`);
  console.log(`  customer    ${CUSTOMER_B}               Maya Chen`);
}

try {
  await main();
} catch (error) {
  console.error("\nSeed failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await client.close();
}
