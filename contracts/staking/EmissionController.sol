/// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount, uint supplyGroup) external;
}

interface IEmissionController {

}

/** [ Reward Formula Isolation ]
 * @title EmissionController
 * @author @Mat L.
 * @notice Monkey-Co Staking Emission Controller module
 */
contract EmissionController is Ownable {
    /// Keycoin
    IMintableERC20 public immutable keycoin; 
    /// Epoch start
    uint256 private _epochStart;
    /// Epoch ID
    uint256 private _epochId;
    /// Weekly epoch length in seconds
    uint256 epochGap = 7 days;

    constructor(address __owner, address __keycoin) Ownable(__owner) {
        require(__owner != address(0) && __keycoin != address(0), "zero-address");
        keycoin = IMintableERC20(__keycoin);
    }

    /**
     * Compute per-epoch reward for a position.
     *
     * Inputs include:
     * - bucketFactorA: A = 0.3 (USDC) or 0.6 (KEY) or 0.1 (ecosystem)
     * - D, Dmax
     * - impact score E (per project)
     * - MS (scarcity from remaining supply)
     * - MP (price modulator)
     * - delta (engagement bonus)
     * - hard APY caps / γ guards
     *
     * MUST enforce system-level caps/guards inside.
     */
    function computeReward(
        address user,
        uint256 positionId,
        uint256 epochId,
        uint256 amountStaked,           // raw principal for this position
        uint256 lockMonths,             // D
        uint256 positionStart,          // position start (for cliff/linear)
        uint256 projectId               // to fetch E
        //bytes calldata auxData        // room for future fields
    ) public view returns (uint256 rewardInKEY) {
        return 0;
    }

    function sendReward(
        address user,
        uint256 positionId,
        uint256 epochId,
        uint256 amountStaked,           // raw principal for this position
        uint256 lockMonths,             // D
        uint256 positionStart,          // position start (for cliff/linear)
        uint256 projectId               // to fetch E
        //bytes calldata auxData        // room for future fields
    ) external returns (bool rSent, uint256 rewardInKEY) {
        rewardInKEY = computeReward(user, positionId, epochId, amountStaked, lockMonths, positionStart, projectId);
        keycoin.mint(user, rewardInKEY, 6);
        rSent = true;
    }

    
    
    /// Return bucketFactor A for this vault (USDC=0.3, KEY=0.6, ecosystem=0.1) in 1e18
    function bucketFactorA() external view returns (uint256) {
        return 3;
    }
    
    /// Return current epoch id (derived from controller’s epoch start).
    function currentEpochId() external view returns (uint256) {
        return _epochId;
    }

    /// Return required epoch start and
}