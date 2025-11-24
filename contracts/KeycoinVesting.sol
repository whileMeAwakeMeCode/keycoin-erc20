// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
using SafeERC20 for IERC20;

interface IKeycoin {
    function keycoinCrowdsale() external view returns(address);
}

/**
 * @title KeycoinVesting v2 (beneficiary actions based)
 * @dev Support multiple vesting receipts per (supplyGroup, beneficiary).
 * Each reception creates a new vesting schedule with its own start/end.
 * - receiveVesting is called by the Keycoin token contract and MUST provide a beneficiary address.
 * - The supply group defines the cliff and duration (in months). The start timestamp is either
 *   provided by the caller or defaults to block.timestamp. end = start + (cliff + duration) months.
 * - release(...) allows the beneficiary to release an amount from a supply group.
 *   Releases are taken from schedules in FIFO order (oldest schedules first) and only from vested amounts.
 */
contract KeycoinVesting is Ownable {
    address internal immutable keycoinERC20;

    struct SupplyGroup {
        uint64 cliff;      // months
        uint64 duration;   // months
        bool exists;
    }

    struct VestingSchedule {
        uint256 amount;    // total amount allocated to this schedule
        uint256 released;  // amount already released from this schedule
        uint64 start;      // start timestamp
        uint64 end;        // end timestamp (start + cliff + duration months)
    }

    // supply group id => supply group config
    mapping(bytes32 => SupplyGroup) public supplyGroups;

    // supplyGroup => beneficiary => schedules[]
    mapping(bytes32 => mapping(address => VestingSchedule[])) private schedules;

    // supplyGroup => total unvested across all schedules
    mapping(bytes32 => uint256) public totalUnvested;

    // account => total amount released to that address
    mapping(address => uint256) public releasedOf;

    event SupplyGroupSet(bytes32 indexed sGroup, uint64 cliffMonths, uint64 durationMonths);
    event VestingReceived(bytes32 indexed sGroup, address indexed beneficiary, uint256 amount, uint64 start, uint64 end, uint256 scheduleIndex);
    event Released(bytes32 indexed sGroup, address indexed beneficiary, uint256 amount);

    constructor(address __owner, address __keycoinERC20) Ownable(__owner) {
        keycoinERC20 = __keycoinERC20;

        // TEAM: 12 months cliff, then 2.5% per month
        _setSupplyGroup(keccak256("TEAM"), 12, 40);
        // CASHFLOW/RESERVE: no cliff, 5% per month
        _setSupplyGroup(keccak256("CASHFLOW"), 0, 20);
        // CROWDSALE: no cliff, then 50% per month (only 80% of the minted tokens are received by this Vesting contract in that group)
        _setSupplyGroup(keccak256("CROWDSALE"), 0, 2);      

    }

    modifier checkSupplyGroup(bytes32 _sGroup) {
        require(supplyGroups[_sGroup].exists, "INVALID SUPPLY GROUP");
        _;
    }

    modifier onlyKeycoin() {
        require(
            (
                address(_msgSender()) == address(keycoinERC20)
                || address(_msgSender()) == IKeycoin(keycoinERC20).keycoinCrowdsale()
            ), 
            "KEYCOIN ONLY"
        );
        _;
    }

    function _setSupplyGroup(bytes32 _sGroup, uint64 _cliff, uint64 _duration) internal {
        require(!supplyGroups[_sGroup].exists, "EXISTING GROUP");
        require(_duration > 0, "ZERO DURATION");
        supplyGroups[_sGroup] = SupplyGroup({cliff: _cliff, duration: _duration, exists: true});
        emit SupplyGroupSet(_sGroup, _cliff, _duration);
    }

    function setSupplyGroup(bytes32 _sGroup, uint64 _cliff, uint64 _duration) external onlyOwner {
        _setSupplyGroup(_sGroup, _cliff, _duration);
    }

    /**
     * @notice Called by Keycoin token contract to create a vesting schedule for a beneficiary.
     * @param _sGroup supply group id
     * @param _beneficiary address receiving the vested tokens
     * @param _amount amount to vest
     */
    function receiveVesting(bytes32 _sGroup, address _beneficiary, uint256 _amount)
        external
        onlyKeycoin
        checkSupplyGroup(_sGroup)
        returns (bool)
    {
        require(_beneficiary != address(0), "ZERO BENEFICIARY");
        require(_amount > 0, "ZERO AMOUNT");

        SupplyGroup memory g = supplyGroups[_sGroup];
        uint256 oneMonth = (365 days) / 12;
        uint64 start = uint64(block.timestamp);
        uint64 end = uint64(uint256(start) + (uint256(g.cliff + g.duration) * oneMonth));

        VestingSchedule memory s = VestingSchedule({amount: _amount, released: 0, start: start, end: end});
        schedules[_sGroup][_beneficiary].push(s);
        totalUnvested[_sGroup] += _amount;

        uint256 idx = schedules[_sGroup][_beneficiary].length - 1;
        emit VestingReceived(_sGroup, _beneficiary, _amount, start, end, idx);
        return true;
    }

    // Returns number of schedules for beneficiary in a supply group
    function getScheduleCount(bytes32 _sGroup, address _beneficiary) external view returns (uint256) {
        return schedules[_sGroup][_beneficiary].length;
    }

    // Returns a single schedule (useful for UI). Beware of gas if many schedules.
    function getSchedule(bytes32 _sGroup, address _beneficiary, uint256 _index)
        external
        view
        returns (uint256 amount, uint256 released, uint64 start, uint64 end)
    {
        VestingSchedule storage s = schedules[_sGroup][_beneficiary][_index];
        return (s.amount, s.released, s.start, s.end);
    }

    // compute releasable for a single schedule
    function _releasableSchedule(VestingSchedule memory s, uint cliff, uint _timestamp) internal view returns (uint256) {
        
        uint timestamp = _timestamp == 0 ? block.timestamp : _timestamp;
        uint oneMonth = 365 days / 12;

        // Calculate cliff time
        uint cliffTime = s.start + (cliff * oneMonth);

        // Before cliff: nothing vested
        if (timestamp < cliffTime) {
            return 0;
        }
        // After end: all vested
        else if (timestamp >= s.end) {
            return s.amount - s.released;
        }
        else {
            // Linear vesting calculation
            uint totalDuration = s.end - cliffTime;
            uint elapsed = timestamp - cliffTime;
            uint vestedSoFar = (s.amount * elapsed) / totalDuration;
        
            if (vestedSoFar <= s.released) {
                return 0;
            }

            return vestedSoFar - s.released;
        }
    }

    // Public view: total releasable for beneficiary in a supplyGroup
    function releasable(bytes32 _sGroup, address _beneficiary, uint _timestamp) public view checkSupplyGroup(_sGroup) returns (uint256) {
        VestingSchedule[] storage arr = schedules[_sGroup][_beneficiary];
        uint256 sum = 0;
        for (uint256 i = 0; i < arr.length; i++) {
            sum += _releasableSchedule(arr[i], supplyGroups[_sGroup].cliff, _timestamp);
        }
        return sum;
    }

    /**
     * @notice Release up to `amount` tokens for beneficiary from supplyGroup.
     * Releases are pulled from schedules in FIFO order (oldest first) and only from vested parts.
     */
    function release(bytes32 _sGroup, uint256 _amount) public checkSupplyGroup(_sGroup) {
        require(_amount > 0, "ZERO AMOUNT");
        address _beneficiary = _msgSender();
        uint256 remaining = _amount;
        VestingSchedule[] storage arr = schedules[_sGroup][_beneficiary];
        uint256 len = arr.length;
        require(len > 0, "NO SCHEDULES");

        uint256 totalReleasedNow = 0;

        for (uint256 i = 0; i < len && remaining > 0; i++) {
            uint256 r = _releasableSchedule(arr[i], supplyGroups[_sGroup].cliff, 0);
            if (r == 0) continue;

            uint256 take = r <= remaining ? r : remaining;
            arr[i].released += take;
            totalUnvested[_sGroup] -= take;
            remaining -= take;
            totalReleasedNow += take;
        }

        require(totalReleasedNow > 0, "UNRELEASABLE YET");
        require(totalReleasedNow <= _amount, "OVER-RELEASED");

        releasedOf[_beneficiary] += totalReleasedNow;
        IERC20(keycoinERC20).safeTransfer(_beneficiary, totalReleasedNow);

        emit Released(_sGroup, _beneficiary, totalReleasedNow);
    }

    // convenience: release all available for beneficiary in a supplyGroup
    function releaseAll(bytes32 _sGroup) external checkSupplyGroup(_sGroup) {
        uint256 r = releasable(_sGroup, _msgSender(), 0);
        require(r > 0, "NO RELEASABLE");
        release(_sGroup, r);
    }

    function totalLockedOf(address account) public view returns(uint lAmount) {
        bytes32[3] memory groups = [
            keccak256("TEAM"),
            keccak256("CASHFLOW"),
            keccak256("CROWDSALE")
        ];

        for (uint256 g = 0; g < groups.length; g++) {
            bytes32 sg = groups[g];
            if (!supplyGroups[sg].exists) continue;


            for (uint256 i = 0; i < schedules[sg][account].length; i++) {
                VestingSchedule memory s = schedules[sg][account][i];
                lAmount += (s.amount - s.released);
            }
        }
    }
}
