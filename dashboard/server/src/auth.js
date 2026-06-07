import basicAuth from 'express-basic-auth';
import { config } from './config.js';

export const auth = basicAuth({
  users: { [config.auth.user]: config.auth.pass },
  challenge: true,
  realm: 'dashboard',
});
