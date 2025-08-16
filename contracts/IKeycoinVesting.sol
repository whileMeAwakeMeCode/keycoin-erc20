// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IKeycoinVesting {
    /**
     * @notice Called when tokens are received for a specific supply group.
     * @param _sGroup The identifier of the supply group.
     * @param _amount The amount of tokens received.
     * @return _received Boolean true if the receipt was processed successfully.
     */
    function receiveVesting(bytes32 _sGroup, uint256 _amount) external returns (bool _received);
}