'use strict';

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const TELEGRAM_CLIENT_ID = process.env.TELEGRAM_CLIENT_ID;
const client = jwksClient({
  jwksUri: 'https://oauth.telegram.org/.well-known/jwks.json',
  cache: true,
  rateLimit: true
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

async function verifyTelegramToken(idToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(idToken, getKey, {
      audience: TELEGRAM_CLIENT_ID,
      issuer: 'https://oauth.telegram.org',
      algorithms: ['RS256']
    }, (err, decoded) => {
      if (err) reject(err);
      else resolve(decoded);
    });
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!TELEGRAM_CLIENT_ID) {
    console.error('TELEGRAM_CLIENT_ID is not configured');
    return res.status(503).json({ error: 'Authentication is not configured' });
  }

  try {
    const { id_token } = req.body;
    
    if (!id_token) {
      return res.status(400).json({ error: 'Missing id_token' });
    }

    const user = await verifyTelegramToken(id_token);
    
    return res.status(200).json({
      success: true,
      user: {
        id: user.sub || user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone_number
      }
    });
  } catch (error) {
    console.error('Telegram auth error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
}