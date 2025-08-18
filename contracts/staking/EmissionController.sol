/// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount, uint supplyGroup) external;
}

interface IEmissionController {

}

/**
 * @title EmissionController
 * @author @Mat L.
 * @notice Monkey-Co Staking Emission Controller module
 */
contract EmissionController is Ownable {
    IMintableERC20 public immutable rewardToken; // KEYCOIN
    IEmissionController public emissionController;

    event EmissionControllerSet(address controller);

    constructor(address __owner, address __rewardToken, address __controller) Ownable(__owner) {
        require(__rewardToken != address(0) && __controller != address(0), "zero");
        rewardToken = IMintableERC20(__rewardToken);
        emissionController = IEmissionController(__controller);
    }

    function setEmissionController(address c) external onlyOwner {
        require(c != address(0), "zero");
        emissionController = IEmissionController(c);
        emit EmissionControllerSet(c);
    }
}