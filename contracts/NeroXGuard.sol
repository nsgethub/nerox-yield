// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/// @title NeroX Guard
/// @notice Risk grades of BNB Smart Chain liquidity pools, readable by other contracts and agent wallets.
///         Grades come from https://neroxcoin.org/yield and are refreshed once a day by the NeroX server.
///         Grade: 1 = A (low risk), 2 = B, 3 = C, 4 = D, 5 = E (very high risk), 0 = pool is not rated.
///         A rule-based check, not financial advice.
contract NeroXGuard {
    address public immutable publisher;
    uint32 public lastDay; // UTC day number (unix time / 86400) of the latest refresh
    uint32 public constant MAX_AGE_DAYS = 3;

    struct Rating {
        uint8 grade;
        uint8 score; // 0..100, higher is safer
    }
    mapping(address => Rating) private ratings;

    event Rated(uint32 indexed day, uint256 changed);

    error NotPublisher();
    error OldDay();
    error BadData();
    error NotAllowed(address pool, uint8 grade);

    constructor() {
        publisher = msg.sender;
    }

    /// @dev data: changed pools, 22 bytes each: 20-byte pool address, 1-byte grade (0..5), 1-byte score.
    function publish(uint32 day, bytes calldata data) external {
        if (msg.sender != publisher) revert NotPublisher();
        if (day < lastDay) revert OldDay();
        if (data.length % 22 != 0) revert BadData();
        uint256 n = data.length / 22;
        for (uint256 i = 0; i < n; i++) {
            uint256 o = i * 22;
            address pool = address(bytes20(data[o:o + 20]));
            uint8 g = uint8(data[o + 20]);
            if (g > 5) revert BadData();
            ratings[pool] = Rating(g, uint8(data[o + 21]));
        }
        lastDay = day;
        emit Rated(day, n);
    }

    /// @notice True while the grades were refreshed within the last MAX_AGE_DAYS days.
    function isFresh() public view returns (bool) {
        return block.timestamp / 1 days <= uint256(lastDay) + MAX_AGE_DAYS;
    }

    /// @notice Grade and score of a pool. Grade 0 means the pool is not rated.
    function gradeOf(address pool) external view returns (uint8 grade, uint8 score, bool fresh) {
        Rating memory r = ratings[pool];
        return (r.grade, r.score, isFresh());
    }

    /// @notice True if the pool is rated, the data is fresh and the grade is not worse than maxGrade (1 = A .. 5 = E).
    function isAllowed(address pool, uint8 maxGrade) public view returns (bool) {
        uint8 g = ratings[pool].grade;
        return g != 0 && g <= maxGrade && isFresh();
    }

    /// @notice Reverts unless isAllowed(pool, maxGrade). Call it before a deposit to block risky pools.
    function requireAllowed(address pool, uint8 maxGrade) external view {
        if (!isAllowed(pool, maxGrade)) revert NotAllowed(pool, ratings[pool].grade);
    }
}
