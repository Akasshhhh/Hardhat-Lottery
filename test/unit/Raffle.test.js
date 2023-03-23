const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", async function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
              const subscriptionId = raffle.getSubscriptionId()
              await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address)
          })

          describe("constructor", () => {
              it("Initializes the raffle correctly", async () => {
                  //ideally we make our test have one assert per "it"
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["Interval"])
              })
          })

          describe("enterRaffle", () => {
              it("reverts when you dont pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__notEnoughETHentered"
                  )
              })

              it("records player when they enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  //As the one pushing the fund currently is deployer so the player array should have the address of deployer
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })

              it("emits an event on enter", async () => {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      //to.emit is a chai matcher function
                      raffle,
                      "RaffleEnter"
                  )
              })

              it("doesnt allow entrance when the raffle is calculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  // to change state from open to calculating we need to performUpkeep() but to perform upkeep checkUpkeep() should be true
                  //evm_IncreaseTime => is used to bypass the time interval
                  //evm_mine => generate a new block containing all the pending transactions in the Ethereum network's transaction pool
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //We pretend to be a chainlink keeper
                  await raffle.performUpkeep([])
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__notOpen"
                  )
              })
          })

          describe("checkUpkeep", () => {
              it("returns false if ETH is not sent", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //To simulate the interval
                  await network.provider.send("evm_mine", []) //to simulate blockConfirmation
                  const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([]) //callstatic is used so that it simulates the transaction and not actually trigger the transaction
                  // {upKeepNeeded } is used as we only need the upKeepNeeded bool
                  assert(!upKeepNeeded)
              })

              it("returns false if raffle isnt open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([])
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })

              it("returns false if enough time hasn't passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.send("evm_mine", [])
                  const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert(!upKeepNeeded)
              })
          })

          describe("performUpkeep", () => {
              it("it can only run when checkUpkeep is true", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  assert(tx)
              })

              it("reverts with error when upkeep not needed", async () => {
                  expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpKeepNotNeeded")
              })

              it("updates the raffle state,emits an event and calls the vrf Coordinator", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId //events[1] is used as this is the second event emitted by the function  //Timestamp => 15:47:33
                  const raffleState = await raffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert.equal(raffleState.toString(), "1")
              })
          })

          describe("fulfillRandomWords()", () => {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })

              it("can only be called after performUpkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })

              it("picks a winner, resets the lottery and sends money", async () => {
                  const additionalEntrants = 3 //3 more entrances in lottery using ethers //total 4 accounts
                  const startingAccountIndex = 1 //as 0 is deployer
                  const accounts = ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountsConnectedRaffle = raffle.connect(accounts[i])
                      await raffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await raffle.getLastTimeStamp()

                  //performUpkeep (mock being chainlink Keepers)
                  //fulfillRandomWords (mocks being the chainlinkVRF)
                  //We will have to wait for the fulfillRandomWords to be called
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("found the event")
                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              console.log(recentWinner)
                              const raffleState = await raffle.getRaffleState()
                              const endingTimeStamp = await raffle.getLastTimeStamp()
                              const numPlayers = await raffle.getNumPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntranceFee
                                          .mul(additionalEntrants)
                                          .add(raffleEntranceFee)
                                          .toString()
                                  )
                              )
                          } catch (error) {
                              reject(error)
                          }
                          resolve()
                      })
                      const tx = await raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.event[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
      })
