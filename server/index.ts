import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 5174);

const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");
const imagesDir = path.join(uploadsDir, "images");
const docsDir = path.join(uploadsDir, "documents");

[dataDir, uploadsDir, imagesDir, docsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isDoc = file.fieldname === "documents";
    cb(null, isDoc ? docsDir : imagesDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "-");
    const stamp = Date.now();
    cb(null, `${stamp}-${safeName}`);
  }
});

const upload = multer({ storage });

const dbPath = path.join(dataDir, "auctions.json");
const adapter = new JSONFile<DatabaseSchema>(dbPath);
const db = new Low(adapter, { items: [] });

type StoredItem = {
  id: string;
  title: string;
  category: string;
  lot: string;
  sku: string;
  condition: string;
  location: string;
  startBid: number;
  reserve: number;
  increment: number;
  currentBid: number;
  startTime: string;
  endTime: string;
  description: string;
  images: { name: string; url: string }[];
  documents: { name: string; url: string }[];
  bids: { bidder: string; amount: number; time: string }[];
  createdAt: string;
};

type DatabaseSchema = {
  items: StoredItem[];
};

const seedIfEmpty = async () => {
  await db.read();
  db.data ||= { items: [] };
  if (db.data.items.length) return;

  const now = Date.now();
  const seedItems: StoredItem[] = [
    {
      id: "LOT-2041",
      title: "Toyota Corolla 2015",
      category: "Cars",
      lot: "CAR-015",
      sku: "FMDQ-CAR-015",
      condition: "Used",
      location: "Lagos Warehouse",
      startBid: 4500000,
      reserve: 6200000,
      increment: 50000,
      currentBid: 5750000,
      startTime: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      endTime: new Date(now + 90 * 60 * 1000).toISOString(),
      description: "Well-maintained sedan, full service history available.",
      images: [],
      documents: [],
      bids: [
        { bidder: "J. Martins", amount: 5400000, time: "09:10" },
        { bidder: "T. Okoro", amount: 5600000, time: "09:22" },
        { bidder: "L. Bello", amount: 5750000, time: "09:33" }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: "LOT-2042",
      title: "Samsung 65 inch UHD Smart TV",
      category: "Household Appliances",
      lot: "HAP-210",
      sku: "FMDQ-HAP-210",
      condition: "Fair",
      location: "Abuja Hub",
      startBid: 180000,
      reserve: 260000,
      increment: 5000,
      currentBid: 205000,
      startTime: new Date(now - 30 * 60 * 1000).toISOString(),
      endTime: new Date(now + 40 * 60 * 1000).toISOString(),
      description: "Screen intact, minor scratches on frame.",
      images: [],
      documents: [],
      bids: [
        { bidder: "K. Yusuf", amount: 190000, time: "09:40" },
        { bidder: "H. Adele", amount: 205000, time: "09:52" }
      ],
      createdAt: new Date().toISOString()
    }
  ];

  db.data.items = seedItems;
  await db.write();
};

const getItems = () => db.data?.items ?? [];

app.get("/api/items", async (req, res) => {
  await db.read();
  const items = getItems().slice().sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(items);
});

app.get("/api/items/:id", async (req, res) => {
  await db.read();
  const item = getItems().find((entry) => entry.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
});

app.post(
  "/api/items",
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "documents", maxCount: 6 }
  ]),
  async (req, res) => {
    await db.read();
    db.data ||= { items: [] };
    const body = req.body as Record<string, string>;
    const id = `LOT-${Math.floor(1000 + Math.random() * 9000)}`;

    const images = ((req.files as Record<string, Express.Multer.File[]>)?.images || []).map((file) => ({
      name: file.originalname,
      url: `/uploads/images/${file.filename}`
    }));

    const documents = ((req.files as Record<string, Express.Multer.File[]>)?.documents || []).map((file) => ({
      name: file.originalname,
      url: `/uploads/documents/${file.filename}`
    }));

    const item: StoredItem = {
      id,
      title: body.title,
      category: body.category,
      lot: body.lot,
      sku: body.sku,
      condition: body.condition,
      location: body.location,
      startBid: Number(body.startBid),
      reserve: Number(body.reserve),
      increment: Number(body.increment || Math.max(500, Math.round(Number(body.startBid) * 0.02))),
      currentBid: 0,
      startTime: new Date(body.startTime).toISOString(),
      endTime: new Date(body.endTime).toISOString(),
      description: body.description || "",
      images,
      documents,
      bids: [],
      createdAt: new Date().toISOString()
    };

    db.data.items.unshift(item);
    await db.write();

    res.status(201).json(item);
  }
);

app.post("/api/items/:id/bids", async (req, res) => {
  await db.read();
  const items = getItems();
  const index = items.findIndex((entry) => entry.id === req.params.id);
  if (index < 0) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const amount = Number(req.body.amount || 0);
  if (!amount || Number.isNaN(amount)) {
    res.status(400).json({ error: "Invalid bid amount" });
    return;
  }

  const bid = {
    bidder: String(req.body.bidder || "Member Bidder"),
    amount,
    time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  };

  items[index].bids.unshift(bid);
  items[index].currentBid = amount;
  await db.write();

  res.json(items[index]);
});

const start = async () => {
  await db.read();
  db.data ||= { items: [] };
  await seedIfEmpty();
  app.listen(port, () => {
    console.log(`Auction API running at http://localhost:${port}`);
  });
};

start();
