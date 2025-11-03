// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../KycVerifier.sol";

abstract contract KEYStakingVault is KycVerifier, ERC20, ReentrancyGuard, Pausable {

    address public immutable keycoin;     

    uint256 public nextPositionId = 1;

    /// Bookkeeping sums
    uint256 public totalStaked;            
    uint256 public totalPositions;

    // user => position id (pid) => Position
    mapping(address => mapping(uint256 => Position)) public userPositions; 
    // positions counter
    mapping(address => uint256) public userPositionCount; 

    /// Position model
    struct Position {
        uint256 amount;        // staked principal
        uint48  start;         // start timestamp
        uint16  lockMonths;    // lock duration in months
        uint32  projectId;     // linked project for E  
        uint32  lastClaimed;   // last claimed epoch id
    }

    event Staked(
        address indexed user,
        uint256 indexed positionId,
        uint256 amount,
        uint16 lockMonths,
        uint32 projectId
    );

    event Unstaked(
        address indexed user,
        uint256 amount
    );

    constructor(address __kycSigner, address __keycoin, address __owner) 
    KycVerifier(__kycSigner, __owner) 
    ERC20("sKeycoin", "SKEYCOIN")
    {
        keycoin = __keycoin;
    }

    function stake(
        uint256 amount,
        uint16 lockMonths,
        uint32 projectId,
        uint256 deadline,            
        bytes calldata signature     
    ) external nonReentrant whenNotPaused {

        require(amount > 0, "stake-amount-zero");
        require(lockMonths > 0 && lockMonths <= 36, "lock-out-of-range"); // allow > Dmax for future boosts over 24 months

        address sender = _msgSender();
        _checkKyc(sender, deadline, signature);

        // Pull tokens
        require(IERC20(keycoin).transferFrom(sender, address(this), amount), "transferFrom-failed");

        uint256 pid = ++userPositionCount[sender];

        userPositions[sender][pid] = Position({
            amount: uint128(amount),
            start: uint48(block.timestamp),
            lockMonths: lockMonths,
            projectId: projectId,
            lastClaimed: uint32(0)
        });
        
        totalPositions += 1;
        totalStaked += amount;

        // mint sKEYCOIN
        _mint(sender, amount);

        // The Staked event must be catched by Monkey-Co Server => DB => UI
        emit Staked(sender, pid, amount, lockMonths, projectId);
    }

    function unstake(uint amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be greater than 0");
        address sender = _msgSender();
        require(balanceOf(sender) >= amount, "Insufficient sKEYCOIN balance");
        require(_totalStakedOf(sender) >= amount, "Insufficient staked amount");
        
        // Burn sKEYCOIN tokens
        _burn(sender, amount);
        
        // Update user's stake positions
        uint pRest = amount;
        uint pCount = userPositionCount[sender];
        for (uint i = 0; i < pCount; i++) {
            if (pRest > 0) {
                if (userPositions[sender][i].amount >= pRest) {
                    userPositions[sender][i].amount -= pRest;      
                    pRest = 0;
                    userPositionCount[sender] -= 1;
                    totalPositions -= 1;
                }   
                else {
                    pRest -= userPositions[sender][i].amount;
                    userPositions[sender][i].amount = 0;
                }   
            }
        }
        
                
        // Transfer KEYCOIN back to the user
        require(IERC20(keycoin).transfer(sender, amount), "Transfer failed");
        
        // Update total staked amount
        totalStaked -= amount;
        
        emit Unstaked(sender, amount);
    }


    function getPosition(address user, uint256 pid) external view returns (Position memory) {
        return userPositions[user][pid];
    }

    function _totalStakedOf(address account) internal view returns(uint _tStake) {
        for (uint i = 0; i < userPositionCount[account]; i++) {
            _tStake += userPositions[account][i].amount;
        }
    }

    function totalStakedOf(address account) public view returns(uint tStake) {
        tStake = _totalStakedOf(account);
    }

}