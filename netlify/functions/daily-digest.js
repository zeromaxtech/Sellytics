const { generateDailyTips, runDigestsForAllUsers } = require('../../server');

module.exports.handler = async (event, context) => {
  console.log('Running scheduled daily digest job (06:00 UTC)');
  try {
    await generateDailyTips();
    const result = await runDigestsForAllUsers();
    console.log(`Scheduled digest run completed: ${result?.sent || 0} digests sent`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Scheduled daily digest completed',
        sent: result?.sent || 0,
      }),
    };
  } catch (err) {
    console.error('Scheduled digest error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
