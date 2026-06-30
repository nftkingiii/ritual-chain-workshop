# Commit-Reveal and Ritual-Native Architecture Note

## Required Track: Commit-Reveal

The implemented contract uses a two-phase privacy pattern that works on any EVM chain. During the submission phase, a participant submits only a `bytes32` commitment. The commitment is calculated from the answer, a private salt, the participant address, and the bounty id:

```solidity
keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
```

The answer is not stored on-chain during the submission phase. During the reveal phase, the participant publishes the answer and salt. The contract verifies the hash and stores the answer only if it matches the original commitment from the same sender for the same bounty.

Only revealed submissions are pushed into the `submissions` array, so `judgeAll` and `finalizeWinner` cannot use unrevealed commitments. The owner can call `judgeAll` only after the reveal deadline, and `finalizeWinner` only after judging is complete. The winner index is checked against the revealed submission array before payment, so the bounty can be paid only once to an eligible participant.

## Advanced Track: Ritual-Native Hidden Submissions

Commit-reveal prevents copying during the submission phase, but plaintext answers become public before AI judging. A Ritual-native version can keep answers hidden until the judging step finishes by encrypting each answer for a Ritual TEE executor or storing encrypted answer blobs off-chain with only references and hashes on-chain.

### Where Plaintext Exists

Plaintext exists first on the participant's device. During judging, plaintext exists inside the Ritual TEE execution environment after the encrypted submissions are decrypted. Plaintext should not exist in public contract storage before judging.

### On-Chain Versus Off-Chain Storage

On-chain storage should contain bounty rules, encrypted submission references, encrypted submission hashes, participant addresses, deadlines, the final winner index, and a hash of the final revealed bundle. Off-chain storage can hold encrypted answer blobs and, after judging, a revealed answer bundle such as an IPFS object. Storing large plaintext answers directly on-chain is expensive and makes privacy irreversible, so an off-chain bundle plus on-chain hash is a better default.

### Batch Judging Flow

Participants encrypt answers for the Ritual TEE and call a submission function that stores either encrypted bytes or a content reference plus hash. After the deadline, the owner calls `judgeAll` once. The Ritual TEE fetches all encrypted submissions, decrypts them privately, constructs one batch LLM prompt containing every answer and the rubric, and asks the LLM to rank the submissions together. This avoids one LLM call per answer and gives the model the full comparison context.

### Final Reveal Pattern

After the TEE receives the LLM result, it produces a structured output:

```json
{
  "winnerIndex": 2,
  "ranking": [{ "index": 2, "score": 94, "reason": "Best satisfies the rubric." }],
  "revealedAnswersRef": "ipfs://...",
  "revealedAnswersHash": "0x...",
  "summary": "Submission 2 is the strongest answer."
}
```

The contract stores the AI review bytes, the `revealedAnswersRef`, and `revealedAnswersHash`. Anyone can later fetch the reveal bundle and verify that its hash matches the on-chain hash. The owner remains human-in-the-loop and finalizes the payout only after reviewing the AI recommendation.

## Security Notes

- A salt must be high entropy; a weak salt can make short answers guessable from the public commitment.
- Including `msg.sender` and `bountyId` prevents commitment copying across participants or bounties.
- Unrevealed commitments are intentionally ignored, because the contract cannot know whether the hidden answer matched the rules.
- The AI recommendation should not automatically move funds unless the output format and winner index are strictly validated.
- Deadlines should be long enough for honest participants to reveal, otherwise valid commitments may become ineligible.
