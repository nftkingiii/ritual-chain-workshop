# Privacy-Preserving AI Bounty Judge

This fork updates the workshop bounty contract so participants cannot read each other's answers during the submission phase. The required track is implemented in `hardhat/contracts/AIJudge.sol` with a generic EVM commit-reveal flow, and the advanced Ritual-native design is documented in `hardhat/ARCHITECTURE.md`.

## Lifecycle

1. The bounty owner calls `createBounty(title, rubric, submissionDeadline, revealDeadline)` and escrows the reward in the contract.
2. Before `submissionDeadline`, each participant computes `keccak256(abi.encodePacked(answer, salt, participant, bountyId))` off-chain and calls `submitCommitment(bountyId, commitment)`.
3. During the submission phase, only the hash is public. The answer and salt stay with the participant.
4. After `submissionDeadline` and before `revealDeadline`, the participant calls `revealAnswer(bountyId, answer, salt)`.
5. The contract recomputes the commitment using the revealed answer, salt, `msg.sender`, and `bountyId`. Only matching reveals are stored as eligible submissions.
6. After `revealDeadline`, the owner batches the revealed answers into one LLM request and calls `judgeAll(bountyId, llmInput)`.
7. After judging completes, the owner calls `finalizeWinner(bountyId, winnerIndex)` to pay exactly one revealed submitter.

## Required Functions

- `submitCommitment(uint256 bountyId, bytes32 commitment)` records one commitment per participant before the submission deadline.
- `revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)` verifies and stores a plaintext answer during the reveal phase.
- `judgeAll(uint256 bountyId, bytes calldata llmInput)` sends one batch judging request to Ritual after the reveal deadline.
- `finalizeWinner(uint256 bountyId, uint256 winnerIndex)` pays one winner selected from the valid revealed submissions.

## Commitment Helper

The contract includes `buildCommitment(...)` as a pure helper so frontends and tests can verify the exact formula:

```solidity
bytes32 commitment = keccak256(
    abi.encodePacked(answer, salt, msg.sender, bountyId)
);
```

Including the sender and bounty id prevents another address from copying a commitment and revealing it as their own answer for a different bounty.

## Test Plan

The executable tests in `hardhat/test/AIJudgeCommitReveal.ts` cover:

- valid commit followed by valid reveal
- duplicate commitment from the same participant
- reveal before the reveal phase starts
- reveal with the wrong salt
- reveal after the reveal deadline
- unrevealed commitments not counting as judgeable submissions

Run them from the Hardhat project:

```shell
cd hardhat
pnpm install
pnpm hardhat test
```

## Reflection

A bounty system should make the bounty description, rubric, deadline, reward, and final payout public so everyone can verify the rules and settlement. Participant answers should stay hidden while submissions are still open, because early public answers create a copying advantage for later participants. Commitments can be public because they prove a participant locked in an answer without revealing its contents. AI is useful for comparing many submissions against a rubric, producing a ranking, and explaining tradeoffs consistently across the batch. A human owner should still decide whether the AI recommendation is acceptable before funds move, because bounties often involve context, abuse checks, and qualitative judgment that should not be blindly automated. The final winner, payout, and enough evidence to audit the decision should become public after judging. If answers are sensitive, the system should publish hashes or a controlled reveal bundle instead of permanently storing every plaintext answer on-chain.
