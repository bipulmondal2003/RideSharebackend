const Rating = require('../models/Rating');
const Booking = require('../models/Booking');
const User = require('../models/User');

// Create a new rating
exports.createRating = async (req, res) => {
  try {
    const { bookingId, score, comment } = req.body;
    const userId = req.user.id;

    if (!bookingId) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    if (!score) {
      return res.status(400).json({ error: 'Rating score is required' });
    }

    const scoreNum = parseInt(score);
    if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 5) {
      return res.status(400).json({ error: 'Score must be between 1 and 5 stars' });
    }

    if (comment && comment.length > 500) {
      return res.status(400).json({ error: 'Comment exceeds 500 character limit' });
    }

    // Get booking with ride details
    const booking = await Booking.findById(bookingId)
      .populate({
        path: 'ride',
        select: 'driver from to',
        populate: { path: 'driver', select: '_id name' }
      })
      .populate('passenger', '_id name');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify booking is completed
    if (booking.status !== 'completed') {
      return res.status(400).json({ 
        error: `Cannot rate. Booking status is "${booking.status}", must be "completed"`
      });
    }

    // Determine rater and ratee
    const passengerId = booking.passenger._id.toString();
    const driverId = booking.ride.driver._id.toString();

    if (userId !== passengerId && userId !== driverId) {
      return res.status(403).json({ error: 'You are not part of this booking' });
    }

    let rateeId, ratingType, alreadyRatedField;

    if (userId === passengerId) {
      rateeId = driverId;
      ratingType = 'passenger-to-driver';
      alreadyRatedField = 'passengerRated';

      if (booking.passengerRated) {
        return res.status(400).json({ error: 'You have already rated this booking' });
      }

      booking.passengerRated = true;
    } else {
      rateeId = passengerId;
      ratingType = 'driver-to-passenger';
      alreadyRatedField = 'driverRated';

      if (booking.driverRated) {
        return res.status(400).json({ error: 'You have already rated this passenger' });
      }

      booking.driverRated = true;
    }

    // Save booking update
    await booking.save();

    // Create rating
    const rating = await Rating.create({
      booking: bookingId,
      ride: booking.ride._id,
      rater: userId,
      ratee: rateeId,
      score: scoreNum,
      comment: comment ? comment.trim().substring(0, 500) : '',
      type: ratingType
    });

    // Update ratee's trust score
    const ratee = await User.findById(rateeId);
    if (ratee) {
      ratee.ratingSum = (ratee.ratingSum || 0) + scoreNum;
      ratee.totalRatings = (ratee.totalRatings || 0) + 1;
      
      // Calculate trust score: round to 1 decimal place
      ratee.trustScore = Math.round(
        (ratee.ratingSum / ratee.totalRatings) * 10
      ) / 10;

      if (ratee.trustScore > 5) ratee.trustScore = 5;
      
      await ratee.save();
    }

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully!',
      rating,
      newTrustScore: ratee.trustScore,
      totalRatings: ratee.totalRatings
    });
  } catch (err) {
    console.error('❌ Create rating error:', err);

    if (err.code === 11000) {
      return res.status(400).json({ error: 'You have already rated this booking' });
    }

    res.status(500).json({ error: 'Failed to submit rating' });
  }
};

// Get all ratings for a user
exports.getUserRatings = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select(
      'name email userType trustScore totalRatings'
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ratings = await Rating.find({ ratee: userId })
      .populate('rater', 'name userType email')
      .populate('booking', 'status')
      .populate('ride', 'from to')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Calculate distribution
    const distribution = {
      5: ratings.filter(r => r.score === 5).length,
      4: ratings.filter(r => r.score === 4).length,
      3: ratings.filter(r => r.score === 3).length,
      2: ratings.filter(r => r.score === 2).length,
      1: ratings.filter(r => r.score === 1).length
    };

    const totalRated = Object.values(distribution).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        trustScore: user.trustScore || 0,
        totalRatings: user.totalRatings || 0
      },
      ratings,
      stats: {
        avgRating: user.trustScore || 0,
        totalRatings: user.totalRatings || 0,
        distribution,
        percentages: {
          5: totalRated ? Math.round((distribution[5] / totalRated) * 100) : 0,
          4: totalRated ? Math.round((distribution[4] / totalRated) * 100) : 0,
          3: totalRated ? Math.round((distribution[3] / totalRated) * 100) : 0,
          2: totalRated ? Math.round((distribution[2] / totalRated) * 100) : 0,
          1: totalRated ? Math.round((distribution[1] / totalRated) * 100) : 0
        }
      }
    });
  } catch (err) {
    console.error('❌ Get user ratings error:', err);
    res.status(500).json({ error: 'Failed to load ratings' });
  }
};

// Check if user can rate this booking
exports.checkRated = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate('passenger', '_id')
      .populate({
        path: 'ride',
        select: 'driver',
        populate: { path: 'driver', select: '_id' }
      });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const passengerId = booking.passenger._id.toString();
    const driverId = booking.ride?.driver?._id?.toString();

    if (userId !== passengerId && userId !== driverId) {
      return res.status(403).json({ error: 'You are not part of this booking' });
    }

    const userRole = userId === passengerId ? 'passenger' : 'driver';
    const hasRated = userRole === 'passenger' ? booking.passengerRated : booking.driverRated;
    const canRate = booking.status === 'completed' && !hasRated;

    res.json({
      success: true,
      canRate,
      hasRated,
      bookingStatus: booking.status,
      userRole
    });
  } catch (err) {
    console.error('❌ Check rated error:', err);
    res.status(500).json({ error: 'Failed to check rating status' });
  }
};

// Get booking details for rating page
exports.getBookingForRating = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate({
        path: 'ride',
        select: 'from to date time car driver',
        populate: { 
          path: 'driver', 
          select: 'name email userType trustScore totalRatings' 
        }
      })
      .populate('passenger', 'name email userType trustScore totalRatings');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (userId !== booking.passenger._id.toString() && 
        userId !== booking.ride.driver._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const isPassenger = userId === booking.passenger._id.toString();
    const otherUser = isPassenger ? booking.ride.driver : booking.passenger;

    res.json({
      success: true,
      booking: {
        _id: booking._id,
        status: booking.status,
        totalPrice: booking.totalPrice,
        date: booking.bookingDate,
        passengerRated: booking.passengerRated,
        driverRated: booking.driverRated
      },
      ride: {
        from: booking.ride.from,
        to: booking.ride.to,
        date: booking.ride.date,
        time: booking.ride.time,
        car: booking.ride.car
      },
      otherUser: {
        _id: otherUser._id,
        name: otherUser.name,
        email: otherUser.email,
        userType: otherUser.userType,
        trustScore: otherUser.trustScore || 'New',
        totalRatings: otherUser.totalRatings || 0
      },
      userRole: isPassenger ? 'passenger' : 'driver'
    });
  } catch (err) {
    console.error('❌ Get booking for rating error:', err);
    res.status(500).json({ error: 'Failed to load booking details' });
  }
};
