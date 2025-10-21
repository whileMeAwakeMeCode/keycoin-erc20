// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (finance/VestingWallet.sol)
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
using SafeERC20 for IERC20;

// import "hardhat/console.sol";

/**
 * @title KeycoinVesting
 * @dev This contract manages vesting schedules for different supply groups of the Keycoin token.
 * It allows Keycoin (the token contract) to allocate tokens to supply groups and the owner to
 * release vested tokens according to linear vesting schedules with optional cliffs.
 */
contract KeycoinVesting is Ownable {
    address internal keycoinERC20;

    struct SupplyGroupVesting {
        uint unvested;     // total unvested (yet-to-be-released) amount
        uint released;     // total released amount
        uint64 cliff;      // lock period in months before vesting starts
        uint64 duration;   // vesting duration in months
        uint64 start;      // timestamp when vesting starts
        uint64 end;        // timestamp when vesting ends
    }

    // supply group identifier => vesting configuration
    mapping(bytes32 => SupplyGroupVesting) public supplyGroupVesting;
    // account => total amount released to that address
    mapping(address => uint256) public releasedOf;

    /**
     * @dev Initializes the contract with an owner and the Keycoin ERC20 token address.
     * Also sets up default supply groups (TEAM and CASHFLOW).
     * @param __owner The address that will own this contract.
     * @param __keycoinERC20 The address of the Keycoin ERC20 token contract.
     */
    constructor(address __owner, address __keycoinERC20) Ownable(__owner) {
        keycoinERC20 = __keycoinERC20;
        
        _setSupplyGroup(keccak256("TEAM"), 12, 40);
        _setSupplyGroup(keccak256("CASHFLOW"), 0, 20);
    }

    /**
     * @dev Modifier to ensure a valid supply group exists.
     * @param _sGroup The bytes32 identifier of the supply group to check.
     */
    modifier checkSupplyGroup(bytes32 _sGroup) {
        require(
            supplyGroupVesting[_sGroup].duration > 0,
            "INVALID SUPPLY GROUP"
        );
        _;
    }

    /**
     * @dev Internal function to create and configure a new supply group vesting schedule.
     * @param _sGroup The bytes32 identifier of the supply group.
     * @param _cliff The cliff duration in months before vesting starts.
     * @param _duration The total vesting duration in months after the cliff.
     */
    function _setSupplyGroup(bytes32 _sGroup, uint64 _cliff, uint64 _duration) internal {
        require(supplyGroupVesting[_sGroup].duration == 0, "EXISTING GROUP");
        require(_duration > 0, "ZERO DURATION");
        uint oneMonth = (365 days) / 12;
        uint end = block.timestamp + (_cliff * oneMonth) + (_duration * oneMonth); 
        supplyGroupVesting[_sGroup] = SupplyGroupVesting(0, 0, _cliff, _duration, uint64(block.timestamp), uint64(end));
    }

    /**
     * @dev Allows the contract owner to set a new supply group configuration.
     * @param _sGroup The bytes32 identifier of the new supply group.
     * @param _cliff The cliff duration in months before vesting starts.
     * @param _duration The total vesting duration in months after the cliff.
     *
     * Requirements:
     * - Caller must be the contract owner.
     */
    function setSupplyGroup(bytes32 _sGroup, uint64 _cliff, uint64 _duration) external onlyOwner {
        _setSupplyGroup(_sGroup, _cliff, _duration);
    }

    /**
     * @dev Modifier restricting access to only the Keycoin ERC20 contract.
     */
    modifier onlyKeycoin() {
        require(address(_msgSender()) == address(keycoinERC20), "KEYCOIN ONLY");
        _;
    }

    /**
     * @dev Called by the Keycoin contract when tokens are assigned to a specific supply group for vesting.
     * @param _sGroup The bytes32 identifier of the supply group receiving tokens.
     * @param _amount The amount of tokens added to the vesting schedule.
     * @return _received Boolean indicating whether the tokens were successfully registered.
     *
     * Requirements:
     * - Caller must be the Keycoin contract.
     * - The supply group must exist.
     */
    function receiveVesting(bytes32 _sGroup, uint _amount)
        external
        onlyKeycoin
        checkSupplyGroup(_sGroup)
        returns (bool _received)
    {
        supplyGroupVesting[_sGroup].unvested += _amount;
        _received = true;
    }

    /**
     * @dev Computes the releasable (vested but unreleased) amount of tokens for a given supply group.
     * Implements a linear vesting curve after the cliff period.
     * @param supplyGroup The bytes32 identifier of the supply group.
     * @param _timestamp The timestamp for which to calculate releasable amount. If 0, defaults to block.timestamp.
     * @return rAmount The amount of tokens that are releasable at the given timestamp.
     */
    function _releasable(bytes32 supplyGroup, uint _timestamp) 
        internal 
        view 
        checkSupplyGroup(supplyGroup) 
        returns (uint rAmount) 
    {
        uint timestamp = _timestamp == 0 ? block.timestamp : _timestamp;
        SupplyGroupVesting memory vesting = supplyGroupVesting[supplyGroup];

        uint totalAllocation = vesting.unvested + vesting.released;
        uint oneMonth = 365 days / 12;

        // Calculate cliff time
        uint cliffTime = vesting.start + (vesting.cliff * oneMonth);

        // Before cliff: nothing vested
        if (timestamp < cliffTime) {
            return 0;
        }
        // After end: all vested
        else if (timestamp >= vesting.end) {
            return vesting.unvested;
        }
        else {
            // Linear vesting calculation
            uint totalDuration = vesting.end - cliffTime;
            uint elapsed = timestamp - cliffTime;
            uint vestedSoFar = (totalAllocation * elapsed) / totalDuration;
        
            if (vestedSoFar <= vesting.released) {
                return 0;
            }

            return vestedSoFar - vesting.released;
        }
    }

    /**
     * @dev Public view wrapper for `_releasable`.
     * @param supplyGroup The bytes32 identifier of the supply group.
     * @param _timestamp Optional timestamp for calculation. If 0, uses current block time.
     * @return rAmount The releasable amount for the supply group.
     */
    function releasable(bytes32 supplyGroup, uint _timestamp) public view returns (uint rAmount) {
        rAmount = _releasable(supplyGroup, _timestamp);
    }

    /**
     * @dev Releases vested tokens for a specific supply group to a recipient address.
     * @param supplyGroup The bytes32 identifier of the supply group to release from.
     * @param amount The amount to be released to the recipient `to`
     * @param to The address to receive the vested tokens.
     *
     * Requirements:
     * - Caller must be the contract owner.
     * - There must be tokens available to release.
     */
    function release(bytes32 supplyGroup, uint amount, address to) public onlyOwner {
        uint rAmount = _releasable(supplyGroup, 0);
        require(rAmount > 0, "UNRELEASABLE YET");
        require(amount <= rAmount, "REQUESTED AMOUNT OVERFLOW");

        SupplyGroupVesting storage vesting = supplyGroupVesting[supplyGroup];

        vesting.released += amount;
        vesting.unvested -= amount;
        releasedOf[to] += amount;

        SafeERC20.safeTransfer(IERC20(keycoinERC20), to, amount);
    }
}
