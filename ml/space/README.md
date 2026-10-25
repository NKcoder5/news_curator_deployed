---
title: Pure Press pair model
emoji: 📰
colorFrom: gray
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

Our own text-pair model for Pure Press (Kongu Engineering College, CSE, team CO5): does a premise support,
say nothing about, or contradict a claim. mDeBERTa-v3-base fine-tuned on NLI, stance and fact-check pairs,
4-bit weights. Called by the backend (`backend/services/localNli.js`); the shipped MiniLM model on the server
answers whenever this Space does not.
