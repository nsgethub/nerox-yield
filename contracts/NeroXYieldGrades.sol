// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/// @title NeroX Yield grades
/// @notice Daily risk grades (A-E) of BNB Smart Chain pools from https://neroxcoin.org/yield.
///         Reading is free for everyone. Only the publisher (the NeroX server) pays to write.
contract NeroXYieldGrades {
    address public immutable publisher;
    uint32 public lastDay;   // UTC day number: unix time / 86400
    uint32 public pools;     // number of pools in the full list of lastDay
    bytes32 public lastHash; // keccak256 of the full packed list of lastDay (file on neroxcoin.org)

    /// @dev changes: pools whose grade changed since the previous publish, 22 bytes each:
    ///      20-byte pool key, 1-byte grade ('A'..'E', 0 = pool removed), 1-byte score (0..100).
    event Grades(uint32 indexed day, bytes32 fullHash, uint32 pools, bytes changes);

    error NotPublisher();
    error OldDay();

    constructor() {
        publisher = msg.sender;
    }

    function publish(uint32 day, bytes32 fullHash, uint32 count, bytes calldata changes) external {
        if (msg.sender != publisher) revert NotPublisher();
        if (day <= lastDay) revert OldDay();
        lastDay = day;
        pools = count;
        lastHash = fullHash;
        emit Grades(day, fullHash, count, changes);
    }
}
