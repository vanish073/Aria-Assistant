'use strict';
const express = require('express');
const path = require('path');

const router = express.Router();

router.get('/', (req, res) => {
  if (!req.session?.userId) {
    return res.redirect('/auth/google');
  }
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

module.exports = router;
