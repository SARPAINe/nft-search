import { Router } from "express";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { NftCreateSchema, NftBulkSchema } from "../schemas/nft.schema.js";
import { validate, getValidated } from "../middleware/validate.js";
import { addNftLimiter, bulkImportLimiter } from "../middleware/rateLimit.js";
import { verifyJwt, verifyApiKey } from "../middleware/auth.js";
import type { z } from "zod";

const router = Router();

type NftCreate = z.infer<typeof NftCreateSchema>;
type NftBulk = z.infer<typeof NftBulkSchema>;

function toPrismaData(input: NftCreate) {
  return {
    token_id: input.token_id,
    contract_address: input.contract_address,
    name: input.name,
    description: input.description ?? null,
    creator_address: input.creator_address,
    owner_address: input.owner_address,
    collection_name: input.collection_name,
    traits: input.traits as Prisma.InputJsonValue,
    price_eth: input.price_eth ? new Prisma.Decimal(input.price_eth) : null,
    is_listed: input.is_listed,
  };
}

function serialize(nft: Awaited<ReturnType<typeof prisma.nft.findUnique>>) {
  if (!nft) return null;
  return {
    ...nft,
    id: nft.id.toString(),
    price_eth: nft.price_eth ? nft.price_eth.toString() : null,
  };
}

// POST /nfts — single create (user, JWT-protected, rate-limited)
router.post(
  "/nfts",
  addNftLimiter,
  verifyJwt,
  validate(NftCreateSchema, "body"),
  async (req: Request, res: Response) => {
    const data = getValidated<NftCreate>(req, "body");
    try {
      const created = await prisma.nft.create({ data: toPrismaData(data) });
      return res.status(201).json(serialize(created));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json({ error: "duplicate", message: "contract_address + token_id already exists" });
      }
      console.error("[nfts] create failed", e);
      return res.status(500).json({ error: "create_failed" });
    }
  },
);

// GET /nfts/:id — simple fetch by primary key
router.get("/nfts/:id", async (req: Request, res: Response) => {
  const raw = req.params.id;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return res.status(400).json({ error: "invalid_id" });
  }
  try {
    const nft = await prisma.nft.findUnique({ where: { id: BigInt(raw) } });
    if (!nft) return res.status(404).json({ error: "not_found" });
    return res.json(serialize(nft));
  } catch (e) {
    console.error("[nfts] fetch failed", e);
    return res.status(500).json({ error: "fetch_failed" });
  }
});

// PATCH /nfts/:id — update mutable fields (owner, price, listed flag, traits)
router.patch("/nfts/:id", verifyJwt, async (req: Request, res: Response) => {
  const raw = req.params.id;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return res.status(400).json({ error: "invalid_id" });
  }

  const PatchSchema = NftCreateSchema.partial().pick({
    description: true,
    owner_address: true,
    price_eth: true,
    is_listed: true,
    traits: true,
  });
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const updated = await prisma.nft.update({
      where: { id: BigInt(raw) },
      data: {
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.owner_address !== undefined ? { owner_address: data.owner_address } : {}),
        ...(data.is_listed !== undefined ? { is_listed: data.is_listed } : {}),
        ...(data.traits !== undefined ? { traits: data.traits as Prisma.InputJsonValue } : {}),
        ...(data.price_eth !== undefined
          ? { price_eth: data.price_eth ? new Prisma.Decimal(data.price_eth) : null }
          : {}),
      },
    });
    return res.json(serialize(updated));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return res.status(404).json({ error: "not_found" });
    }
    console.error("[nfts] update failed", e);
    return res.status(500).json({ error: "update_failed" });
  }
});

// DELETE /nfts/:id — admin operation, gated by API key
router.delete("/nfts/:id", verifyApiKey, async (req: Request, res: Response) => {
  const raw = req.params.id;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return res.status(400).json({ error: "invalid_id" });
  }
  try {
    await prisma.nft.delete({ where: { id: BigInt(raw) } });
    return res.status(204).end();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return res.status(404).json({ error: "not_found" });
    }
    console.error("[nfts] delete failed", e);
    return res.status(500).json({ error: "delete_failed" });
  }
});

// POST /nfts/bulk — bulk import (admin, API-key gated, rate-limited)
// skipDuplicates relies on the (contract_address, token_id) unique constraint.
router.post(
  "/nfts/bulk",
  bulkImportLimiter,
  verifyApiKey,
  validate(NftBulkSchema, "body"),
  async (req: Request, res: Response) => {
    const { items } = getValidated<NftBulk>(req, "body");
    try {
      const result = await prisma.nft.createMany({
        data: items.map(toPrismaData),
        skipDuplicates: true,
      });
      return res.status(201).json({
        inserted: result.count,
        skipped: items.length - result.count,
        total: items.length,
      });
    } catch (e) {
      console.error("[nfts] bulk failed", e);
      return res.status(500).json({ error: "bulk_failed" });
    }
  },
);

export default router;
