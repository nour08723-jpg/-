import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../db.js';

export type CurrentUser = { id: number; roleCode: string; permissions: string[]; username: string };

declare global {
  namespace Express { interface Request { user?: CurrentUser } }
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: 'غير مصرح' });
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: number };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } }
    });
    if (!user || !user.isActive) return res.status(401).json({ message: 'المستخدم غير صالح' });
    req.user = {
      id: user.id,
      username: user.username,
      roleCode: user.role.code,
      permissions: user.role.rolePermissions.map((rp) => rp.permission.code)
    };
    next();
  } catch {
    return res.status(401).json({ message: 'جلسة غير صالحة' });
  }
}

export const permit = (...permissions: string[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ message: 'غير مصرح' });
  if (!permissions.every((p) => req.user!.permissions.includes(p))) {
    return res.status(403).json({ message: 'ليس لديك صلاحية كافية' });
  }
  next();
};
