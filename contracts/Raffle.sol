//Enter the lottery
//Pick a random winner
//Winner to be selected every X minutes -> Completely automated

//Chainlink Oracle -> Randomness,Automated Execution (Chainlink Keepers)

// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.4;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

error Raffle__notEnoughETHentered();
error Raffle__transferFailed();
error Raffle__notOpen();
error Raffle__UpKeepNotNeeded(uint balance, uint numPlayers, uint raffleState);

contract Raffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
    /*Type Declarations*/
    enum RaffleState {
        OPEN,
        CALCULATING
    } //uint 0 = OPEN, 1 = CALCULATING

    //State Variables
    uint private immutable i_entranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_keyHash;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint16 private constant NUM_WORDS = 1;

    //Lottery Variables
    address private s_recentWinner;
    RaffleState private s_RaffleState;
    uint private s_lastTimeStamp;
    uint private immutable i_Interval;

    //Events
    event RaffleEnter(address indexed player);
    event requestRaffleWinner(uint indexed requestId);
    event WinnerPicked(address indexed winner);

    constructor(
        address vrfCoordinatorV2,
        uint entranceFee,
        bytes32 keyHash,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        uint Interval
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_keyHash = keyHash;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        s_RaffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_Interval = Interval;
    }

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert Raffle__notEnoughETHentered();
        }

        if (s_RaffleState != RaffleState.OPEN) {
            revert Raffle__notOpen();
        }

        s_players.push(payable(msg.sender));
        //Name events with the function name reversed
        emit RaffleEnter(msg.sender);
    }

    /**
    @dev  This is the function that Chainlink Keepers call they look for the `upkeepNeeded` to return true.
    The following should be true in order to return true
    1.Our time interval should have passed.
    2.The lottery should have atleast one player and some ETH
    3.Our subscription should be funded with LINK
    4.Lottery state should be open
    */

    //IN Official checkUpkeep function it is specified external i.e. it can only be called by external contracts so we change it to public so that our contract
    //can call it too
    function checkUpkeep(
        bytes memory /* checkData */
    ) public view override returns (bool upkeepNeeded, bytes memory /* checkData */) {
        bool isOpen = (RaffleState.OPEN == s_RaffleState);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_Interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = (address(this).balance > 0);
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
        //(block.timestamp - last block timestamp) > interval
    }

    function performUpkeep(bytes calldata /* performData */) external override {
        (bool upKeepNeeded, ) = checkUpkeep("");
        if (!upKeepNeeded) {
            revert Raffle__UpKeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint(s_RaffleState)
            );
        }
        // Requests the random number
        s_RaffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_keyHash,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        emit requestRaffleWinner(requestId);
    }

    function fulfillRandomWords(
        uint256 /*requestId*/,
        uint[] memory randomWords
    ) internal override {
        uint indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        s_RaffleState = RaffleState.OPEN;
        s_players = new address payable[](0);
        s_lastTimeStamp = block.timestamp;
        (bool success, ) = recentWinner.call{value: address(this).balance}("");

        if (!success) {
            revert Raffle__transferFailed();
        }
        emit WinnerPicked(recentWinner);
    }

    function getEntranceFee() public view returns (uint) {
        return i_entranceFee;
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getPlayer(uint index) public view returns (address) {
        return s_players[index];
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_RaffleState;
    }

    //pure is used here as NUM_WORDS is constant
    function getNumWords() public pure returns (uint) {
        return NUM_WORDS;
    }

    function getInterval() public view returns (uint) {
        return i_Interval;
    }

    function getSubscriptionId() public view returns (uint) {
        return i_subscriptionId;
    }

    function getLastTimeStamp() public view returns (uint) {
        return s_lastTimeStamp;
    }

    function getNumPlayers() public view returns (uint) {
        return s_players.length;
    }
}
