import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodePacked, keccak256, parseEther, toHex } from "viem";

function commitmentFor(
  answer: string,
  salt: `0x${string}`,
  submitter: `0x${string}`,
  bountyId: bigint,
) {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "address", "uint256"],
      [answer, salt, submitter, bountyId],
    ),
  );
}

async function deployFixture() {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [owner, alice, bob] = await viem.getWalletClients();
  const aiJudge = await viem.deployContract("AIJudge");

  const block = await publicClient.getBlock();
  const submissionDeadline = block.timestamp + 60n;
  const revealDeadline = submissionDeadline + 60n;

  await aiJudge.write.createBounty(
    ["Privacy bounty", "Pick the strongest private submission", submissionDeadline, revealDeadline],
    { account: owner.account, value: parseEther("1") },
  );

  return {
    aiJudge,
    publicClient,
    testClient,
    owner,
    alice,
    bob,
    bountyId: 1n,
    submissionDeadline,
    revealDeadline,
  };
}

async function moveTo(testClient: Awaited<ReturnType<typeof deployFixture>>["testClient"], timestamp: bigint) {
  await testClient.setNextBlockTimestamp({ timestamp });
  await testClient.mine({ blocks: 1 });
}

describe("AIJudge commit-reveal", () => {
  it("accepts a valid commitment reveal and stores only the revealed answer", async () => {
    const { aiJudge, testClient, alice, bountyId, submissionDeadline } = await deployFixture();
    const answer = "Use a commit-reveal flow with a bounded reveal phase.";
    const salt = keccak256(toHex("alice salt"));
    const commitment = commitmentFor(answer, salt, alice.account.address, bountyId);

    await aiJudge.write.submitCommitment([bountyId, commitment], {
      account: alice.account,
    });

    let bounty = await aiJudge.read.getBounty([bountyId]);
    assert.equal(bounty[8], 1n, "commitment count");
    assert.equal(bounty[9], 0n, "revealed submission count before reveal");

    await moveTo(testClient, submissionDeadline);
    await aiJudge.write.revealAnswer([bountyId, answer, salt], {
      account: alice.account,
    });

    bounty = await aiJudge.read.getBounty([bountyId]);
    assert.equal(bounty[8], 1n, "commitment count after reveal");
    assert.equal(bounty[9], 1n, "revealed submission count after reveal");

    const submission = await aiJudge.read.getSubmission([bountyId, 0n]);
    assert.equal(submission[0].toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(submission[1], answer);
  });

  it("rejects a second commitment from the same participant", async () => {
    const { aiJudge, alice, bountyId } = await deployFixture();
    const first = commitmentFor("first", keccak256(toHex("one")), alice.account.address, bountyId);
    const second = commitmentFor("second", keccak256(toHex("two")), alice.account.address, bountyId);

    await aiJudge.write.submitCommitment([bountyId, first], { account: alice.account });

    await assert.rejects(
      aiJudge.write.submitCommitment([bountyId, second], { account: alice.account }),
      /commitment already submitted/,
    );
  });

  it("rejects reveals before the reveal phase", async () => {
    const { aiJudge, alice, bountyId } = await deployFixture();
    const answer = "Too early";
    const salt = keccak256(toHex("early"));
    const commitment = commitmentFor(answer, salt, alice.account.address, bountyId);

    await aiJudge.write.submitCommitment([bountyId, commitment], { account: alice.account });

    await assert.rejects(
      aiJudge.write.revealAnswer([bountyId, answer, salt], { account: alice.account }),
      /reveal phase not started/,
    );
  });

  it("rejects a reveal with the wrong salt", async () => {
    const { aiJudge, testClient, alice, bountyId, submissionDeadline } = await deployFixture();
    const answer = "Correct answer";
    const salt = keccak256(toHex("right"));
    const wrongSalt = keccak256(toHex("wrong"));
    const commitment = commitmentFor(answer, salt, alice.account.address, bountyId);

    await aiJudge.write.submitCommitment([bountyId, commitment], { account: alice.account });
    await moveTo(testClient, submissionDeadline);

    await assert.rejects(
      aiJudge.write.revealAnswer([bountyId, answer, wrongSalt], { account: alice.account }),
      /invalid reveal/,
    );
  });

  it("rejects reveals after the reveal deadline", async () => {
    const { aiJudge, testClient, alice, bountyId, revealDeadline } = await deployFixture();
    const answer = "Too late";
    const salt = keccak256(toHex("late"));
    const commitment = commitmentFor(answer, salt, alice.account.address, bountyId);

    await aiJudge.write.submitCommitment([bountyId, commitment], { account: alice.account });
    await moveTo(testClient, revealDeadline);

    await assert.rejects(
      aiJudge.write.revealAnswer([bountyId, answer, salt], { account: alice.account }),
      /reveal phase closed/,
    );
  });

  it("does not count unrevealed commitments as judgeable submissions", async () => {
    const { aiJudge, alice, bob, bountyId } = await deployFixture();
    const aliceCommitment = commitmentFor("Alice", keccak256(toHex("a")), alice.account.address, bountyId);
    const bobCommitment = commitmentFor("Bob", keccak256(toHex("b")), bob.account.address, bountyId);

    await aiJudge.write.submitCommitment([bountyId, aliceCommitment], { account: alice.account });
    await aiJudge.write.submitCommitment([bountyId, bobCommitment], { account: bob.account });

    const bounty = await aiJudge.read.getBounty([bountyId]);
    assert.equal(bounty[8], 2n, "both commitments are recorded");
    assert.equal(bounty[9], 0n, "no revealed submissions are eligible yet");
  });
});
