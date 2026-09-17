import { Router } from 'express';
import { handleGetMe, handleLogin, handleRegister } from '../controllers/authController';
import { authenticate } from '../middleware/authMiddleware';

export const authRouter = Router();

authRouter.post('/register', handleRegister);
authRouter.post('/login', handleLogin);
authRouter.get('/me', authenticate, handleGetMe);
