// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (finance/VestingWallet.sol)
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
using SafeERC20 for IERC20;

contract KeycoinVesting is Ownable {
    address internal keycoinERC20;

    struct SupplyGroupVesting {
        uint unvested;
        uint released;
        uint64 cliff;       // in month
        uint64 duration;    // in month
        uint64 start;
        uint64 end;
    }

    mapping(bytes32 => SupplyGroupVesting) public supplyGroupVesting;

    constructor(address __owner, address __keycoinERC20) Ownable(__owner) {
        keycoinERC20 = __keycoinERC20;
        
        _setSupplyGroup(keccak256("TEAM"), 12, 40);
        _setSupplyGroup(keccak256("CASHFLOW"), 0, 20);
    }


    modifier checkSupplyGroup(bytes32 _sGroup) {
        require(
            supplyGroupVesting[_sGroup].duration > 0,
            "INVALID SUPPLY GROUP"
        );
        _;
    }

    function _setSupplyGroup(bytes32 _sGroup, uint64 _cliff, uint64 _duration) internal {
        require(supplyGroupVesting[_sGroup].duration == 0, "EXISTING GROUP");
        require(_duration > 0, "ZERO DURATION");
        uint oneMonth = (365 days) / 12;
        uint end = block.timestamp + (_cliff * oneMonth) + (_duration * oneMonth); 
        supplyGroupVesting[_sGroup] = SupplyGroupVesting(0,0,_cliff,_duration, uint64(block.timestamp), uint64(end));
    }

    function setSupplyGroup(bytes32 _sGroup, uint64 _cliff, uint64 _duration) external onlyOwner {
        _setSupplyGroup(_sGroup, _cliff, _duration);
    }

    modifier onlyKeycoin() {
        require(address(_msgSender()) == address(keycoinERC20), "KEYCOIN ONLY");
        _;
    }

    function receiveVesting(bytes32 _sGroup, uint _amount) external onlyKeycoin checkSupplyGroup(_sGroup) returns(bool _received){
        supplyGroupVesting[_sGroup].unvested += _amount;
        _received = true;
    }

    /**
     * @dev Compute the releaseable amount of an unvested ERC20 token on behalf of an holder (implementation is a linear vesting curve)
     * @param supplyGroup a valid bytes32 supply group, ex. keccak256("TEAM")
     * @param _timestamp unix timestamp of the release date (*optionnal* default: block.timestamp)
     * @return rAmount the amount of a keycoin supply group that is releasable at `_timestamp` time in a linear curve
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

        // real starting point post cliff
        uint cliffTime = vesting.start + (vesting.cliff * oneMonth);

        // if before start -> 0
        if (timestamp < cliffTime) {
            return 0;
        }
        // if after end -> all vested
        else if (timestamp >= vesting.end) {
            return vesting.unvested;
        }
        else {
            // linear vesting effective lenght (post cliff)
            uint totalDuration = vesting.end - cliffTime;
            uint elapsed = timestamp - cliffTime;

            uint vestedSoFar = (totalAllocation * elapsed) / totalDuration;

            if (vestedSoFar <= vesting.released) {
                return 0;
            }

            return vestedSoFar - vesting.released;
        }
    }

    function releasable(bytes32 supplyGroup, uint _timestamp) public view returns(uint rAmount) {
        rAmount = _releasable(supplyGroup, _timestamp);
    }

    function release(bytes32 supplyGroup, address to) public onlyOwner {
        uint rAmount = _releasable(supplyGroup, 0);
        require(rAmount > 0, "UNRELEASABLE YET");
        SupplyGroupVesting memory vesting = supplyGroupVesting[supplyGroup];
        vesting.released += rAmount;
        SafeERC20.safeTransfer(IERC20(keycoinERC20), to, rAmount);
    }
    
}