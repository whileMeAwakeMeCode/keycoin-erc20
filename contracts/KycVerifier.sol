/// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


/**
 * @title Monkey-Co KycVerifier
 * @author Mathieu L.
 * @notice Monkey-Co KYC validation module
 */
contract KycVerifier is Ownable {
    using ECDSA for bytes32;

    address public kycSigner; // Trusted signer set by admin

    event KycSignerUpdated(address newSigner);

    /**
     * @dev On build : set `kycSigner` responsible for 
     * @param _kycSigner kyc signer/validator address (contract OR EOA)
     */
    constructor(address _kycSigner, address __owner) Ownable(__owner) {
        kycSigner = _kycSigner;
    }

    /** [owner-only]
     * @dev Externally set a new `kycSigner`
     * @param _newSigner kyc signer/validator address (contract OR EOA)
     */
    function setKycSigner(address _newSigner) external /* onlyOwner */ {
        // onlyOwner in pratique
        require(_newSigner != address(0), "invalid");
        kycSigner = _newSigner;
        emit KycSignerUpdated(_newSigner);
    }

    /**
     * @dev Internally check that a KYC signature belongs to the legit `kycSigner`
     * @param user address of the user concerned by this check
     * @param deadline timestamp of the signature availability deadline
     * @param signature the bytes32 encoded KYC signature itself
     */
    function _checkKyc(address user, uint256 deadline, bytes memory signature) internal view {
        require(kycSigner != address(0), "INVALID-KYC-SIGNER");
        require(verifyKyc(user, deadline, signature), "INVALID-KYC");
    }

    // EIP-191 (Ethereum Signed Message)
    /**
     * @dev Externally check that a KYC signature belongs to the legit `kycSigner`
     * @param user address of the user concerned by this check
     * @param deadline timestamp of the signature availability deadline
     * @param signature the bytes32 encoded KYC signature itself
     * @return valid boolean indicating whether or not a kyc signature is valid
     */
    function verifyKyc(address user, uint256 deadline, bytes memory signature) public view returns (bool valid) {
        bytes32 structHash = keccak256(abi.encode(user, deadline));
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(structHash);
        return ECDSA.recover(digest, signature) == kycSigner;
    }


}