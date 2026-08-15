import { Request, Response, Router } from "express";
import { analyzeTypeScript } from "../analyzers/typescript";

const router = Router();

router.post("/analyze", (req: Request, res: Response) => {
    const code = req.body?.code;

    if (typeof code !== "string" || code.trim().length === 0) {
        return res.status(400).json({ error: "A non-empty code string is required." });
    }

    return res.status(200).json(analyzeTypeScript(code));
});

export default router;
