const Report = require('../models/Report');

exports.createReport = async (req, res) => {
  try {
    const { reportedId, rideId, reason, details } = req.body;
    if (!reportedId || !reason) return res.status(400).json({ error: 'reportedId and reason required' });
    if (reportedId === req.user.id) return res.status(400).json({ error: 'Cannot report yourself' });

    const report = await Report.create({
      reporter: req.user.id, reported: reportedId,
      ride: rideId || undefined, reason, details
    });
    res.status(201).json(report);
  } catch (err) { res.status(500).json({ error: 'Failed to submit report' }); }
};

exports.getMyReports = async (req, res) => {
  try {
    const reports = await Report.find({ reporter: req.user.id })
      .populate('reported', 'name email userType')
      .sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) { res.status(500).json({ error: 'Failed to load reports' }); }
};
