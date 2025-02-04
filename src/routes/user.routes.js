const express = require('express');
const router = express.Router();

// In-memory storage
let users = [];
let nextId = 1;

// Get all users
router.get('/', async (req, res) => {
  try {
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single user
router.get('/:id', async (req, res) => {
  try {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create user
router.post('/', async (req, res) => {
  try {
    const user = {
      id: nextId++,
      name: req.body.name,
      email: req.body.email,
      age: req.body.age,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    users.push(user);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update user
router.put('/:id', async (req, res) => {
  try {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index !== -1) {
      users[index] = {
        ...users[index],
        name: req.body.name || users[index].name,
        email: req.body.email || users[index].email,
        age: req.body.age || users[index].age,
        updatedAt: new Date()
      };
      res.json(users[index]);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index !== -1) {
      users.splice(index, 1);
      res.json({ message: 'User deleted' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 