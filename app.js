const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (error) {
    console.log(`DB Error: ${error.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

// API 1: Register New User
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const userCheckQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(userCheckQuery)

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const registerUserQuery = `
        INSERT INTO user (username, password, name, gender)
        VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`
      await db.run(registerUserQuery)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

// Authentication Middleware
const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }

  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET_KEY', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

// API 2: User Login
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const userCheckQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(userCheckQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// Middleware to check if user follows the author of a tweet
const isFollowing = async (request, response, next) => {
  const {tweetId} = request.params
  const {username} = request
  const getUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const followingQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ${userId};`
  const userFollowingData = await db.all(followingQuery)

  const tweetUserQuery = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId};`
  const tweetData = await db.get(tweetUserQuery)
  const tweetUserId = tweetData.user_id

  let isTweetUserInFollowing = false
  userFollowingData.forEach(each => {
    if (each.following_user_id === tweetUserId) {
      isTweetUserInFollowing = true
    }
  })

  if (isTweetUserInFollowing) {
    next()
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
}

// API 3: Get latest tweets from following
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const query = `
    SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
    FROM follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id
    INNER JOIN user ON tweet.user_id = user.user_id
    WHERE follower.follower_user_id = ${userId}
    ORDER BY dateTime DESC
    LIMIT 4;`
  const data = await db.all(query)
  response.send(data)
})

// API 4: Get list of people the user follows
app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const query = `
    SELECT name FROM user
    INNER JOIN follower ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${userId};`
  const data = await db.all(query)
  response.send(data)
})

// API 5: Get list of followers of the user
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const query = `
    SELECT name FROM user
    INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${userId};`
  const data = await db.all(query)
  response.send(data)
})

// API 6: Get specific tweet details
app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  isFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const query = `
    SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies,
    date_time AS dateTime
    FROM tweet
    WHERE tweet_id = ${tweetId};`
    const data = await db.get(query)
    response.send(data)
  },
)

// API 7: Get usernames who liked a tweet
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  isFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const query = `
    SELECT username FROM user
    NATURAL JOIN like
    WHERE tweet_id = ${tweetId};`
    const data = await db.all(query)
    const usernamesArray = data.map(each => each.username)
    response.send({likes: usernamesArray})
  },
)

// API 8: Get replies to a specific tweet
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  isFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const query = `
    SELECT name, reply FROM user
    NATURAL JOIN reply
    WHERE tweet_id = ${tweetId};`
    const data = await db.all(query)
    response.send({replies: data})
  },
)

// API 9: Get all tweets of the user
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const query = `
    SELECT tweet,
    COUNT(DISTINCT like_id) AS likes,
    COUNT(DISTINCT reply_id) AS replies,
    date_time AS dateTime
    FROM tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`
  const data = await db.all(query)
  response.send(data)
})

// API 10: Post a tweet
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const {username} = request
  const getUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const query = `
    INSERT INTO tweet (tweet, user_id)
    VALUES ('${tweet}', ${userId});`
  await db.run(query)
  response.send('Created a Tweet')
})

// API 11: Delete a tweet
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request
    const getUserQuery = `SELECT user_id FROM user WHERE username = '${username}';`
    const dbUser = await db.get(getUserQuery)
    const userId = dbUser.user_id

    const userTweetQuery = `SELECT tweet_id FROM tweet WHERE user_id = ${userId};`
    const userTweetsData = await db.all(userTweetQuery)

    let isTweetUser = false
    userTweetsData.forEach(each => {
      if (each.tweet_id === parseInt(tweetId)) {
        isTweetUser = true
      }
    })

    if (isTweetUser) {
      const query = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`
      await db.run(query)
      response.send('Tweet Removed')
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

module.exports = app
