import 'package:flutter/material.dart';

class HomePage extends StatefulWidget {
  @override
  _HomePageState createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<String> favourites = [];
  List<String> recentItems = [];
  bool isLoggedIn = true;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Home'),
        actions: <Widget>[
          IconButton(
            icon: Icon(Icons.settings),
            onPressed: () {
              // Navigate to settings
            },
          ),
          IconButton(
            icon: Icon(Icons.exit_to_app),
            onPressed: () {
              // Logout action
            },
          ),
        ],
      ),
      body: _buildFocusGrid(),
    );
  }

  Widget _buildFocusGrid() {
    return Column(
      children: [
        _rebuildRow1(),
        _rebuildRow2(),
        _rebuildRow3(),
      ],
    );
  }

  Widget _rebuildRow1() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: <Widget>[
        Text('Favourites'),
        IconButton(
          icon: Icon(Icons.favorite),
          onPressed: () {
            // Toggle favourite items
          },
        ),
      ],
    );
  }

  Widget _rebuildRow2() {
    return Column(
      children: recentItems.map((item) {
        return ListTile(
          title: Text(item),
        );
      }).toList(),
    );
  }

  Widget _rebuildRow3() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: <Widget>[
        Text('Settings'),
        Text('Logout'),
      ],
    );
  }
}